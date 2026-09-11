-- =============================================================================
-- Hotzonex Cloud — core tenancy, identity and authorization helpers.
--
-- Conventions for every migration in this project:
--   * Every business table carries tenant_id and has RLS enabled with explicit
--     per-role policies. No table relies on default privileges.
--   * Writes that must be validated beyond a row check go through SECURITY
--     DEFINER functions with search_path = '' and fully-qualified names.
--   * Authorization helpers live in schema `app`, which PostgREST does not expose.
-- =============================================================================

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.app_role as enum ('SUPER_ADMIN', 'ADMIN', 'TECHNICIAN', 'RESELLER', 'CUSTOMER');
create type public.profile_status as enum ('active', 'suspended');

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------
create function app.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tenants
-- -----------------------------------------------------------------------------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'),
  currency_default char(3) not null default 'SSP' check (currency_default ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger tenants_touch before update on public.tenants
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null check (char_length(email) between 3 and 320),
  full_name text not null default '' check (char_length(full_name) <= 120),
  role public.app_role not null,
  status public.profile_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_tenant_id_idx on public.profiles (tenant_id);
create unique index profiles_email_key on public.profiles (lower(email));
create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Authorization helpers. SECURITY DEFINER so policies on `profiles` can call
-- them without recursing into their own RLS. STABLE so the planner caches
-- them per statement; policies wrap calls in (select …) for init-plan caching.
-- -----------------------------------------------------------------------------
create function app.user_tenant_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.tenant_id from public.profiles p where p.id = auth.uid() and p.status = 'active'
$$;

create function app.user_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.status = 'active'
$$;

create function app.has_role(roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.user_role() = any (roles), false)
$$;

create function app.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role(array['SUPER_ADMIN']::public.app_role[])
$$;

-- Staff = the roles that operate the network in Phase 1.
create function app.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role(array['SUPER_ADMIN', 'ADMIN', 'TECHNICIAN']::public.app_role[])
$$;

-- True when the caller may see rows of tenant `t` at all.
create function app.in_tenant(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_super_admin() or (t is not null and t = app.user_tenant_id())
$$;

-- Staff member with visibility into tenant `t`.
create function app.staff_in_tenant(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_staff() and app.in_tenant(t)
$$;

-- Caller may administer tenant `t` (ADMIN of that tenant, or SUPER_ADMIN).
create function app.admin_of(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_super_admin()
      or (app.has_role(array['ADMIN']::public.app_role[]) and t = app.user_tenant_id())
$$;

-- Caller may operate routers in tenant `t` (ADMIN or TECHNICIAN of that tenant, or SUPER_ADMIN).
create function app.operator_of(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_super_admin()
      or (app.has_role(array['ADMIN', 'TECHNICIAN']::public.app_role[]) and t = app.user_tenant_id())
$$;

revoke all on all functions in schema app from public;
grant execute on function
  app.user_tenant_id(), app.user_role(), app.has_role(public.app_role[]), app.is_super_admin(),
  app.is_staff(), app.in_tenant(uuid), app.staff_in_tenant(uuid), app.admin_of(uuid), app.operator_of(uuid)
  to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Tenants & profiles: privileges and RLS
-- -----------------------------------------------------------------------------
alter table public.tenants enable row level security;
alter table public.profiles enable row level security;

revoke all on public.tenants from anon, authenticated;
grant select on public.tenants to authenticated;
grant update (name, currency_default) on public.tenants to authenticated;
grant all on public.tenants to service_role;

create policy tenants_select on public.tenants for select to authenticated
  using ((select app.in_tenant(id)));
create policy tenants_update on public.tenants for update to authenticated
  using ((select app.admin_of(id)))
  with check ((select app.admin_of(id)));

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant all on public.profiles to service_role;

-- Everyone sees their own profile; staff see their teammates.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select app.staff_in_tenant(tenant_id)));
-- Only your own name. Role and status change through update_member().
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Invitations. Sign-up is invite-only: an ADMIN invites an email with a role,
-- the invitee signs up with the one-time token, and a trigger on auth.users
-- turns the invite into a profile. Token hashes live in a deny-all table.
-- -----------------------------------------------------------------------------
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 320),
  role public.app_role not null check (role in ('ADMIN', 'TECHNICIAN')),
  invited_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index invites_tenant_id_idx on public.invites (tenant_id);
create unique index invites_open_email_key on public.invites (tenant_id, lower(email))
  where accepted_at is null and revoked_at is null;

create table public.invite_tokens (
  invite_id uuid primary key references public.invites (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$')
);

alter table public.invites enable row level security;
alter table public.invite_tokens enable row level security;
revoke all on public.invites from anon, authenticated;
revoke all on public.invite_tokens from anon, authenticated;
grant select on public.invites to authenticated;
grant all on public.invites, public.invite_tokens to service_role;

create policy invites_select on public.invites for select to authenticated
  using ((select app.admin_of(tenant_id)));
-- invite_tokens: RLS enabled, no policies → no API role can read or write it.

create function app.token_hash(token text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(token, 'UTF8')), 'hex')
$$;
revoke all on function app.token_hash(text) from public;

create function public.create_invite(p_email text, p_role public.app_role)
returns table (invite_id uuid, token text)
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.user_tenant_id();
  v_email text := lower(btrim(p_email));
  v_token text;
  v_id uuid;
begin
  if v_tenant is null or not app.admin_of(v_tenant) then
    raise exception 'Only an administrator can invite team members.' using errcode = '42501', hint = 'forbidden';
  end if;
  if p_role not in ('ADMIN', 'TECHNICIAN') then
    raise exception 'Invitations can grant the Admin or Technician role only.' using errcode = '22023', hint = 'invalid_role';
  end if;
  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.' using errcode = '22023', hint = 'invalid_email';
  end if;
  if exists (select 1 from public.profiles p where lower(p.email) = v_email) then
    raise exception 'That email already belongs to a Hotzonex Cloud user.' using errcode = '23505', hint = 'already_member';
  end if;

  -- Re-inviting replaces any open invite for the same address.
  update public.invites set revoked_at = now()
   where tenant_id = v_tenant and lower(email) = v_email and accepted_at is null and revoked_at is null;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.invites (tenant_id, email, role, invited_by)
  values (v_tenant, v_email, p_role, auth.uid())
  returning id into v_id;
  insert into public.invite_tokens (invite_id, token_hash) values (v_id, app.token_hash(v_token));

  return query select v_id, v_token;
end;
$$;

create function public.revoke_invite(p_invite_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  select i.tenant_id into v_tenant from public.invites i where i.id = p_invite_id;
  if v_tenant is null or not app.admin_of(v_tenant) then
    raise exception 'Invitation not found.' using errcode = 'P0002', hint = 'not_found';
  end if;
  update public.invites set revoked_at = now()
   where id = p_invite_id and accepted_at is null and revoked_at is null;
  delete from public.invite_tokens where invite_id = p_invite_id;
end;
$$;

-- Public lookup used by the sign-up page before it calls auth.signUp().
create function public.get_invite(p_token text)
returns table (email text, role public.app_role, tenant_name text, expires_at timestamptz, state text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return query select null::text, null::public.app_role, null::text, null::timestamptz, 'not_found'::text;
    return;
  end if;
  return query
    select i.email, i.role, t.name, i.expires_at,
           case when i.revoked_at is not null then 'revoked'
                when i.accepted_at is not null then 'used'
                when i.expires_at <= now() then 'expired'
                else 'valid' end
      from public.invite_tokens k
      join public.invites i on i.id = k.invite_id
      join public.tenants t on t.id = i.tenant_id
     where k.token_hash = app.token_hash(p_token);
  if not found then
    return query select null::text, null::public.app_role, null::text, null::timestamptz, 'not_found'::text;
  end if;
end;
$$;

-- Admin changes a teammate's role or suspends them.
create function public.update_member(p_profile_id uuid, p_role public.app_role, p_status public.profile_status)
returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  v_target public.profiles;
  v_result public.profiles;
begin
  select * into v_target from public.profiles where id = p_profile_id;
  if not found or not app.admin_of(v_target.tenant_id) then
    raise exception 'Team member not found.' using errcode = 'P0002', hint = 'not_found';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'You cannot change your own role or status.' using errcode = '42501', hint = 'self_change';
  end if;
  if v_target.role = 'SUPER_ADMIN' and not app.is_super_admin() then
    raise exception 'Only a super administrator can change another super administrator.' using errcode = '42501', hint = 'forbidden';
  end if;
  if p_role = 'SUPER_ADMIN' and not app.is_super_admin() then
    raise exception 'Only a super administrator can grant that role.' using errcode = '42501', hint = 'forbidden';
  end if;
  if p_role in ('RESELLER', 'CUSTOMER') then
    raise exception 'Reseller and customer accounts are not available yet.' using errcode = '22023', hint = 'invalid_role';
  end if;

  update public.profiles set role = p_role, status = p_status where id = p_profile_id
  returning * into v_result;
  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- New auth user → profile. Only two paths create a profile:
--   1. a valid, unexpired invite token matching the email (user sign-up), or
--   2. provisioning by the seed script via the admin API (app_metadata is not
--      user-writable, so this cannot be forged from the browser).
-- -----------------------------------------------------------------------------
create function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_token text := new.raw_user_meta_data ->> 'invite_token';
  v_invite public.invites;
begin
  if coalesce(new.raw_app_meta_data ->> 'provisioned_by', '') = 'hotzonex-seed' then
    return new;
  end if;
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

  if not found or lower(v_invite.email) <> lower(new.email) then
    raise exception 'This invitation is invalid, expired, or for a different email address.'
      using errcode = '42501', hint = 'invite_invalid';
  end if;

  insert into public.profiles (id, tenant_id, email, full_name, role)
  values (new.id, v_invite.tenant_id, lower(new.email),
          left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120), v_invite.role);
  update public.invites set accepted_at = now(), accepted_by = new.id where id = v_invite.id;
  delete from public.invite_tokens where invite_id = v_invite.id;
  return new;
end;
$$;
revoke all on function app.handle_new_user() from public;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

revoke all on function public.create_invite(text, public.app_role) from public, anon;
revoke all on function public.revoke_invite(uuid) from public, anon;
revoke all on function public.update_member(uuid, public.app_role, public.profile_status) from public, anon;
revoke all on function public.get_invite(text) from public;
grant execute on function public.create_invite(text, public.app_role) to authenticated;
grant execute on function public.revoke_invite(uuid) to authenticated;
grant execute on function public.update_member(uuid, public.app_role, public.profile_status) to authenticated;
grant execute on function public.get_invite(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- System settings (per tenant, validated per key)
-- -----------------------------------------------------------------------------
create function app.setting_is_valid(p_key text, p_value jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case p_key
    when 'health_poll_interval_seconds' then jsonb_typeof(p_value) = 'number'
         and (p_value #>> '{}')::numeric between 60 and 3600 and (p_value #>> '{}')::numeric % 1 = 0
    when 'offline_after_missed_polls' then jsonb_typeof(p_value) = 'number'
         and (p_value #>> '{}')::numeric between 1 and 10 and (p_value #>> '{}')::numeric % 1 = 0
    when 'metrics_retention_days' then jsonb_typeof(p_value) = 'number'
         and (p_value #>> '{}')::numeric between 7 and 365 and (p_value #>> '{}')::numeric % 1 = 0
    else false
  end
$$;

create table public.system_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint system_settings_key_value_valid check (app.setting_is_valid(key, value)),
  unique (tenant_id, key)
);
create index system_settings_tenant_id_idx on public.system_settings (tenant_id);
create trigger system_settings_touch before update on public.system_settings
  for each row execute function app.touch_updated_at();

create function app.stamp_settings_actor() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if tg_op = 'INSERT' and new.tenant_id is null then
    new.tenant_id := app.user_tenant_id();
  end if;
  return new;
end;
$$;
create trigger system_settings_actor before insert or update on public.system_settings
  for each row execute function app.stamp_settings_actor();

alter table public.system_settings enable row level security;
revoke all on public.system_settings from anon, authenticated;
grant select, delete on public.system_settings to authenticated;
grant insert (tenant_id, key, value) on public.system_settings to authenticated;
grant update (value) on public.system_settings to authenticated;
grant all on public.system_settings to service_role;

create policy system_settings_select on public.system_settings for select to authenticated
  using ((select app.staff_in_tenant(tenant_id)));
create policy system_settings_insert on public.system_settings for insert to authenticated
  with check ((select app.admin_of(tenant_id)));
create policy system_settings_update on public.system_settings for update to authenticated
  using ((select app.admin_of(tenant_id)))
  with check ((select app.admin_of(tenant_id)));
create policy system_settings_delete on public.system_settings for delete to authenticated
  using ((select app.admin_of(tenant_id)));
