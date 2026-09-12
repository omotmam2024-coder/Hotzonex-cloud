-- =============================================================================
-- Accounts created outside the invite flow wait for approval.
--
-- Users can now be created directly in Supabase (dashboard "Add user", or the
-- Auth Admin API). Supabase gives the database no reliable way to tell those
-- apart from a public sign-up, so neither path grants anything by itself:
--   * no invite token      → the auth account is created with NO profile.
--                            Without a profile every RLS policy denies access;
--                            the app shows "No access yet".
--   * a valid invite token → profile in the inviting tenant, as before.
--   * a bad/expired token  → still rejected, so the invite page gives a clear error.
-- A SUPER_ADMIN lists waiting accounts, grants a staff role (which creates
-- the profile in their own tenant), or removes the account.
-- =============================================================================

create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_app jsonb;
  v_meta jsonb;
  v_email text;
  v_token text;
  v_invite public.invites;
begin
  -- Deferred to commit (migration …800): read the row as Supabase Auth finished writing it.
  select u.raw_app_meta_data, u.raw_user_meta_data, u.email into v_app, v_meta, v_email
    from auth.users u where u.id = new.id;
  if not found then
    return null;
  end if;
  if exists (select 1 from public.profiles p where p.id = new.id) then
    return null;
  end if;
  if coalesce(v_app ->> 'provisioned_by', '') = 'hotzonex-seed' then
    return null;
  end if;

  v_token := v_meta ->> 'invite_token';
  if v_token is null then
    return null; -- waits for a SUPER_ADMIN to grant access
  end if;
  if v_token !~ '^[0-9a-f]{64}$' then
    raise exception 'This invitation is invalid, expired, or for a different email address.'
      using errcode = '42501', hint = 'invite_invalid';
  end if;

  select i.* into v_invite
    from public.invite_tokens k
    join public.invites i on i.id = k.invite_id
   where k.token_hash = app.token_hash(v_token)
     and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
   for update of i;

  if not found or lower(v_invite.email) <> lower(v_email) then
    raise exception 'This invitation is invalid, expired, or for a different email address.'
      using errcode = '42501', hint = 'invite_invalid';
  end if;

  insert into public.profiles (id, tenant_id, email, full_name, role)
  values (new.id, v_invite.tenant_id, lower(v_email),
          left(btrim(coalesce(v_meta ->> 'full_name', '')), 120), v_invite.role);
  update public.invites set accepted_at = now(), accepted_by = new.id where id = v_invite.id;
  delete from public.invite_tokens where invite_id = v_invite.id;
  return null;
end;
$$;
revoke all on function app.handle_new_user() from public;

-- -----------------------------------------------------------------------------
-- Waiting accounts. SUPER_ADMIN only: these accounts belong to no tenant yet,
-- so listing them to a tenant ADMIN would disclose other people's emails.
-- -----------------------------------------------------------------------------
create function public.list_pending_accounts()
returns table (user_id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, email_confirmed boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_super_admin() then
    raise exception 'Only a super administrator can see accounts waiting for access.' using errcode = '42501', hint = 'forbidden';
  end if;
  return query
    select u.id, lower(u.email)::text, u.created_at, u.last_sign_in_at, u.email_confirmed_at is not null
      from auth.users u
     where not exists (select 1 from public.profiles p where p.id = u.id)
       and u.email is not null
     order by u.created_at desc
     limit 200;
end;
$$;

create function public.grant_access(p_user_id uuid, p_role public.app_role, p_full_name text default null)
returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.user_tenant_id();
  v_email text;
  v_profile public.profiles;
begin
  if not app.is_super_admin() or v_tenant is null then
    raise exception 'Only a super administrator can grant access.' using errcode = '42501', hint = 'forbidden';
  end if;
  if p_role not in ('SUPER_ADMIN', 'ADMIN', 'TECHNICIAN') then
    raise exception 'Reseller and customer accounts are not available yet.' using errcode = '22023', hint = 'invalid_role';
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = p_user_id;
  if v_email is null then
    raise exception 'Account not found.' using errcode = 'P0002', hint = 'not_found';
  end if;
  if exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'This account already has access.' using errcode = '23505', hint = 'not_pending';
  end if;
  if exists (select 1 from public.profiles p where lower(p.email) = v_email) then
    raise exception 'That email already belongs to a Hotzonex Cloud user.' using errcode = '23505', hint = 'already_member';
  end if;

  insert into public.profiles (id, tenant_id, email, full_name, role)
  values (p_user_id, v_tenant, v_email, left(btrim(coalesce(p_full_name, '')), 120), p_role)
  returning * into v_profile;

  perform app.write_audit(v_tenant, 'team.member.access_granted', 'profile', p_user_id::text, null,
                          jsonb_build_object('email', v_email, 'role', p_role));
  return v_profile;
end;
$$;

-- Removes an account that never received access (e.g. an unwanted public sign-up).
create function public.remove_pending_account(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.user_tenant_id();
  v_email text;
begin
  if not app.is_super_admin() or v_tenant is null then
    raise exception 'Only a super administrator can remove accounts.' using errcode = '42501', hint = 'forbidden';
  end if;
  if exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'This account has access; suspend it in the team list instead.' using errcode = '23505', hint = 'not_pending';
  end if;
  delete from auth.users u where u.id = p_user_id returning lower(u.email) into v_email;
  if v_email is null then
    raise exception 'Account not found.' using errcode = 'P0002', hint = 'not_found';
  end if;
  perform app.write_audit(v_tenant, 'team.pending.removed', 'user', p_user_id::text,
                          jsonb_build_object('email', v_email), null);
end;
$$;

revoke all on function public.list_pending_accounts() from public, anon;
revoke all on function public.grant_access(uuid, public.app_role, text) from public, anon;
revoke all on function public.remove_pending_account(uuid) from public, anon;
grant execute on function public.list_pending_accounts() to authenticated;
grant execute on function public.grant_access(uuid, public.app_role, text) to authenticated;
grant execute on function public.remove_pending_account(uuid) to authenticated;
