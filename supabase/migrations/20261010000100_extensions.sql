-- =====================================================================
-- Hotzonex Cloud — additions on top of the core schema
--   * staff management by email (RPC only; no direct membership writes)
--   * voucher disable via RPC (no direct voucher writes from the browser)
--   * network device inventory (APs, switches, bridges, Starlink, OLT …)
--   * cross-tenant guards (a site must belong to the row's tenant)
--   * hardened function grants (anon can execute nothing)
-- =====================================================================

-- ---------- Tighten write paths -------------------------------------
-- Admins edit memberships only through add_member/remove_member, so an admin
-- can never promote themselves to owner by updating their own row.
drop policy if exists memberships_admin on public.memberships;
-- Vouchers change state only through RPCs/the router API, so usage counters
-- and codes can't be edited by hand from the browser.
drop policy if exists vouchers_admin_update on public.vouchers;

-- ---------- Cross-tenant guard --------------------------------------
create or replace function public.guard_site_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.site_id is not null and not exists (
    select 1 from sites where id = new.site_id and tenant_id = new.tenant_id
  ) then
    raise exception 'site does not belong to this business' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger plans_site_guard       before insert or update on public.plans
  for each row execute function public.guard_site_tenant();
create trigger agents_site_guard      before insert or update on public.agents
  for each row execute function public.guard_site_tenant();
create trigger memberships_site_guard before insert or update on public.memberships
  for each row execute function public.guard_site_tenant();
create trigger routers_site_guard     before insert or update on public.routers
  for each row execute function public.guard_site_tenant();

-- Plans keep the tenant's currency unless set explicitly.
alter table public.plans alter column currency set default 'SSP';

-- ---------- Network device inventory --------------------------------
create type public.device_kind as enum
  ('router', 'switch', 'access_point', 'bridge', 'olt', 'onu', 'starlink',
   'media_converter', 'ups', 'server', 'other');

create table public.devices (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants on delete cascade,
  site_id        uuid references public.sites on delete set null,   -- null = in store / unassigned
  kind           public.device_kind not null default 'other',
  name           text not null,
  vendor         text,
  model          text,
  serial         text,
  mac            text,
  ip             text,
  location       text,          -- "Mast 2, 12 m", "Rack U14"
  status         text not null default 'in_service'
                 check (status in ('in_service', 'spare', 'faulty', 'retired')),
  installed_on   date,
  purchase_price numeric(12,2) check (purchase_price is null or purchase_price >= 0),
  currency       text not null default 'USD',
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index devices_tenant_site_idx on public.devices (tenant_id, site_id);

create trigger devices_site_guard before insert or update on public.devices
  for each row execute function public.guard_site_tenant();

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
create trigger devices_touch before update on public.devices
  for each row execute function public.touch_updated_at();

alter table public.devices enable row level security;
create policy devices_select on public.devices for select to authenticated
  using (site_id is null and member_role_in(tenant_id) is not null
         or can_see_site(tenant_id, site_id));
create policy devices_admin on public.devices for all to authenticated
  using (is_admin(tenant_id)) with check (is_admin(tenant_id));

-- ---------- Staff management ----------------------------------------
create or replace function public.list_members(p_tenant uuid)
returns table (user_id uuid, email text, role public.member_role, site_id uuid)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not is_admin(p_tenant) then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select m.user_id, u.email::text, m.role, m.site_id
      from public.memberships m join auth.users u on u.id = m.user_id
     where m.tenant_id = p_tenant
     order by m.role, u.email;
end $$;

create or replace function public.add_member(
  p_tenant uuid, p_email text, p_role public.member_role, p_site uuid default null
) returns uuid language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid; v_caller public.member_role;
begin
  v_caller := member_role_in(p_tenant);
  if v_caller is null or v_caller not in ('owner', 'admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_role = 'owner' and v_caller <> 'owner' then
    raise exception 'only an owner can add another owner' using errcode = '42501';
  end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'no account with that email — ask them to sign up on the login page first';
  end if;
  if v_user = auth.uid() then raise exception 'you cannot change your own role'; end if;
  if exists (select 1 from memberships where tenant_id = p_tenant and user_id = v_user and role = 'owner')
     and v_caller <> 'owner' then
    raise exception 'only an owner can change an owner' using errcode = '42501';
  end if;

  insert into memberships (tenant_id, user_id, role, site_id)
  values (p_tenant, v_user, p_role, p_site)
  on conflict (tenant_id, user_id) do update set role = excluded.role, site_id = excluded.site_id;
  return v_user;
end $$;

create or replace function public.remove_member(p_tenant uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_caller public.member_role; v_target public.member_role;
begin
  v_caller := member_role_in(p_tenant);
  if v_caller is null or v_caller not in ('owner', 'admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_user = auth.uid() then raise exception 'you cannot remove yourself'; end if;
  select role into v_target from memberships where tenant_id = p_tenant and user_id = p_user;
  if v_target = 'owner' and v_caller <> 'owner' then
    raise exception 'only an owner can remove an owner' using errcode = '42501';
  end if;
  delete from memberships where tenant_id = p_tenant and user_id = p_user;
end $$;

-- ---------- Voucher admin actions -----------------------------------
-- Disabled vouchers are kicked and removed from the router on the next sync.
create or replace function public.disable_vouchers(p_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  update vouchers v set status = 'disabled'
   where v.id = any(p_ids)
     and v.status in ('unused', 'sold', 'active')
     and is_admin(v.tenant_id);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Safer prefix: letters/digits only, at most 6 chars (RouterOS-safe usernames).
create or replace function public.generate_vouchers_checked(
  p_plan_id uuid, p_quantity int, p_prefix text default '', p_length int default 8,
  p_charset text default 'numeric'
) returns uuid language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_prefix, '') !~ '^[A-Za-z0-9]{0,6}$' then
    raise exception 'prefix must be up to 6 letters or digits';
  end if;
  return generate_vouchers(p_plan_id, p_quantity, p_prefix, p_length, p_charset);
end $$;

-- ---------- Function grants -----------------------------------------
-- Postgres grants EXECUTE to PUBLIC by default; close that for every RPC
-- and open only what the signed-in app needs.
revoke execute on function public.member_role_in(uuid)                       from public, anon;
revoke execute on function public.is_admin(uuid)                             from public, anon;
revoke execute on function public.can_see_site(uuid, uuid)                   from public, anon;
revoke execute on function public.create_tenant(text, text)                  from public, anon;
revoke execute on function public.generate_vouchers(uuid, int, text, int, text) from public, anon;
revoke execute on function public.generate_vouchers_checked(uuid, int, text, int, text) from public, anon;
revoke execute on function public.sell_voucher(uuid, public.payment_method, text, text) from public, anon;
revoke execute on function public.list_members(uuid)                         from public, anon;
revoke execute on function public.add_member(uuid, text, public.member_role, uuid) from public, anon;
revoke execute on function public.remove_member(uuid, uuid)                  from public, anon;
revoke execute on function public.disable_vouchers(uuid[])                   from public, anon;
revoke execute on function public.guard_site_tenant()                         from public, anon, authenticated;

grant execute on function public.member_role_in(uuid)                        to authenticated, service_role;
grant execute on function public.is_admin(uuid)                              to authenticated, service_role;
grant execute on function public.can_see_site(uuid, uuid)                    to authenticated, service_role;
grant execute on function public.create_tenant(text, text)                   to authenticated;
grant execute on function public.generate_vouchers(uuid, int, text, int, text) to authenticated;
grant execute on function public.generate_vouchers_checked(uuid, int, text, int, text) to authenticated;
grant execute on function public.sell_voucher(uuid, public.payment_method, text, text) to authenticated;
grant execute on function public.list_members(uuid)                          to authenticated;
grant execute on function public.add_member(uuid, text, public.member_role, uuid) to authenticated;
grant execute on function public.remove_member(uuid, uuid)                   to authenticated;
grant execute on function public.disable_vouchers(uuid[])                    to authenticated;

-- Realtime for the voucher list. (routers is NOT published: Realtime would
-- ship the whole row, including secret_ciphertext.)
alter publication supabase_realtime add table public.vouchers;
