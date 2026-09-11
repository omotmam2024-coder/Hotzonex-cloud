-- =============================================================================
-- Sign-up trigger runs at commit, not at insert.
--
-- Supabase Auth's admin createUser() inserts the auth.users row and then sets
-- app_metadata in a second statement of the same transaction. An AFTER INSERT
-- trigger therefore could not see provisioned_by = 'hotzonex-seed' and
-- rejected the seed admin as an uninvited sign-up ("Database error creating
-- new user"). A DEFERRABLE INITIALLY DEFERRED constraint trigger fires at
-- commit and re-reads the row, so it sees the user exactly as Auth finished
-- writing it. Invite-only enforcement is unchanged: a failure still aborts the
-- whole transaction, so no auth user is left behind without a profile.
-- =============================================================================

drop trigger if exists on_auth_user_created on auth.users;

create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_app jsonb;
  v_meta jsonb;
  v_email text;
  v_token text;
  v_invite public.invites;
begin
  -- The row as it is now, at commit (NEW is the row as first inserted).
  select u.raw_app_meta_data, u.raw_user_meta_data, u.email into v_app, v_meta, v_email
    from auth.users u where u.id = new.id;
  if not found then
    return null; -- created and deleted in the same transaction
  end if;
  if exists (select 1 from public.profiles p where p.id = new.id) then
    return null;
  end if;
  if coalesce(v_app ->> 'provisioned_by', '') = 'hotzonex-seed' then
    return null; -- the seed script creates this profile itself
  end if;

  v_token := v_meta ->> 'invite_token';
  if v_token is null or v_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Hotzonex Cloud is invite-only. Ask an administrator for an invitation.'
      using errcode = '42501', hint = 'invite_required';
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

create constraint trigger on_auth_user_created after insert on auth.users
  deferrable initially deferred
  for each row execute function app.handle_new_user();
