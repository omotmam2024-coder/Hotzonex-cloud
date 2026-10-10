-- Hotzonex Cloud: complete database setup. Paste into Supabase → SQL Editor → Run, on an EMPTY project.
-- Same content as supabase/migrations/*.sql, concatenated.

-- >>> supabase/migrations/20261010000000_core.sql
-- =====================================================================
-- Hotzonex Cloud — core schema (Supabase, Postgres 15+)
-- Voucher lifecycle: create → push → sell → activate → expire → remove
-- Apply as ONE migration on a fresh public schema.
-- =====================================================================

create extension if not exists pgcrypto;  -- Supabase keeps it in schema "extensions"

-- ---------- Types ----------------------------------------------------
create type public.member_role    as enum ('owner', 'admin', 'cashier', 'agent');
create type public.voucher_status as enum ('unused', 'sold', 'active', 'expired', 'disabled');
create type public.router_conn    as enum ('rest', 'api');
create type public.payment_method as enum ('cash', 'agent_code');

-- ---------- Tables ---------------------------------------------------
create table public.tenants (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  currency                text not null default 'SSP',
  auto_sale_on_activation boolean not null default true,
  created_at              timestamptz not null default now()
);

create table public.sites (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants on delete cascade,
  name           text not null,
  timezone       text not null default 'Africa/Juba',
  opens_at       time,
  closes_at      time,
  hotspot_server text not null default 'all',   -- RouterOS hotspot server name, or 'all'
  created_at     timestamptz not null default now(),
  unique (tenant_id, name)
);

create table public.memberships (
  tenant_id uuid not null references public.tenants on delete cascade,
  user_id   uuid not null references auth.users on delete cascade,
  role      public.member_role not null,
  site_id   uuid references public.sites on delete set null,  -- null = all sites
  primary key (tenant_id, user_id)
);

create table public.routers (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants on delete cascade,
  site_id           uuid not null unique references public.sites on delete cascade,
  name              text not null,
  host              text not null,              -- tunnel IP (10.99.0.x) or public IP/DNS
  port              int  not null check (port between 1 and 65535),
  conn              public.router_conn not null default 'rest',
  tls               boolean not null default false,
  username          text not null,
  secret_ciphertext text not null,              -- AES-256-GCM, written only by router API
  routeros_version  text,
  board_name        text,
  status            text not null default 'unknown'
                    check (status in ('unknown', 'online', 'offline', 'auth_failed')),
  last_seen_at      timestamptz,
  last_error        text,
  created_at        timestamptz not null default now()
);

create table public.plans (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants on delete cascade,
  site_id          uuid not null references public.sites on delete cascade,
  name             text not null,                -- e.g. '1 Hour', 'LITE', 'Power'
  price            numeric(12,2) not null check (price >= 0),
  currency         text not null default 'SSP',
  uptime_seconds   int not null check (uptime_seconds > 0),   -- pushed as limit-uptime
  validity_seconds int check (validity_seconds > 0),          -- wall-clock window after first login
  bytes_limit      bigint check (bytes_limit > 0),            -- pushed as limit-bytes-total
  hotspot_profile  text not null default 'default',           -- rate-limit/shared-users live here
  color            text not null default '#0ea5e9',
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (site_id, name)
);

create table public.agents (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants on delete cascade,
  site_id        uuid references public.sites on delete set null,  -- null = any site
  name           text not null,
  phone          text,
  code           text not null check (code = upper(code)),
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 100),
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (tenant_id, code)
);

create table public.voucher_batches (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants on delete cascade,
  site_id    uuid not null references public.sites on delete cascade,
  plan_id    uuid not null references public.plans on delete restrict,
  quantity   int  not null,
  prefix     text not null default '',
  charset    text not null default 'numeric',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.vouchers (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants on delete cascade,
  site_id             uuid not null references public.sites on delete cascade,
  plan_id             uuid not null references public.plans on delete restrict,
  batch_id            uuid references public.voucher_batches on delete set null,
  code                text not null,
  password            text not null,
  status              public.voucher_status not null default 'unused',
  pushed_at           timestamptz,   -- exists on router
  push_error          text,
  removed_at          timestamptz,   -- removed from router after expiry/disable
  sold_at             timestamptz,
  first_login_at      timestamptz,
  expires_at          timestamptz,
  expired_at          timestamptz,
  uptime_used_seconds int    not null default 0,
  bytes_used          bigint not null default 0,
  created_at          timestamptz not null default now(),
  unique (tenant_id, code)
);
create index vouchers_site_status_idx on public.vouchers (site_id, status);
create index vouchers_pending_push_idx on public.vouchers (site_id) where pushed_at is null;
create index vouchers_plan_unused_idx on public.vouchers (plan_id, created_at) where status = 'unused';

create table public.sales (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants on delete cascade,
  site_id    uuid not null references public.sites on delete cascade,
  voucher_id uuid not null unique references public.vouchers on delete restrict,
  plan_id    uuid not null references public.plans on delete restrict,
  amount     numeric(12,2) not null,
  currency   text not null,
  method     public.payment_method not null default 'cash',
  agent_id   uuid references public.agents on delete set null,
  sold_by    uuid references auth.users on delete set null,
  sold_at    timestamptz not null default now(),
  note       text
);
create index sales_tenant_time_idx on public.sales (tenant_id, sold_at);
create index sales_site_time_idx on public.sales (site_id, sold_at);

create table public.active_sessions (
  router_id      uuid not null references public.routers on delete cascade,
  tenant_id      uuid not null references public.tenants on delete cascade,
  site_id        uuid not null references public.sites on delete cascade,
  username       text not null,
  mac            text not null default '',
  address        text,
  uptime_seconds int    not null default 0,
  bytes_in       bigint not null default 0,
  bytes_out      bigint not null default 0,
  voucher_id     uuid references public.vouchers on delete set null,
  seen_at        timestamptz not null default now(),
  primary key (router_id, username, mac)
);

-- ---------- Access helpers ------------------------------------------
create or replace function public.member_role_in(p_tenant uuid)
returns public.member_role language sql stable security definer set search_path = public as $$
  select role from memberships where tenant_id = p_tenant and user_id = auth.uid()
$$;

create or replace function public.is_admin(p_tenant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships
                 where tenant_id = p_tenant and user_id = auth.uid()
                   and role in ('owner', 'admin'))
$$;

create or replace function public.can_see_site(p_tenant uuid, p_site uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m
                 where m.tenant_id = p_tenant and m.user_id = auth.uid()
                   and (m.site_id is null or m.site_id = p_site))
$$;

-- ---------- RLS ------------------------------------------------------
alter table public.tenants         enable row level security;
alter table public.sites           enable row level security;
alter table public.memberships     enable row level security;
alter table public.routers         enable row level security;
alter table public.plans           enable row level security;
alter table public.agents          enable row level security;
alter table public.voucher_batches enable row level security;
alter table public.vouchers        enable row level security;
alter table public.sales           enable row level security;
alter table public.active_sessions enable row level security;

create policy tenants_select on public.tenants for select to authenticated
  using (member_role_in(id) is not null);
create policy tenants_update on public.tenants for update to authenticated
  using (is_admin(id)) with check (is_admin(id));

create policy memberships_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or is_admin(tenant_id));
create policy memberships_admin on public.memberships for all to authenticated
  using (is_admin(tenant_id)) with check (is_admin(tenant_id));

create policy sites_select on public.sites for select to authenticated
  using (can_see_site(tenant_id, id));
create policy sites_admin on public.sites for all to authenticated
  using (is_admin(tenant_id)) with check (is_admin(tenant_id));

-- routers: read-only from the browser; all writes go through the router API (service role)
create policy routers_select on public.routers for select to authenticated
  using (can_see_site(tenant_id, site_id));

create policy plans_select on public.plans for select to authenticated
  using (can_see_site(tenant_id, site_id));
create policy plans_admin on public.plans for all to authenticated
  using (is_admin(tenant_id)) with check (is_admin(tenant_id));

create policy agents_select on public.agents for select to authenticated
  using (site_id is null and member_role_in(tenant_id) is not null
         or can_see_site(tenant_id, site_id));
create policy agents_admin on public.agents for all to authenticated
  using (is_admin(tenant_id)) with check (is_admin(tenant_id));

create policy batches_select on public.voucher_batches for select to authenticated
  using (can_see_site(tenant_id, site_id));

create policy vouchers_select on public.vouchers for select to authenticated
  using (can_see_site(tenant_id, site_id));
create policy vouchers_admin_update on public.vouchers for update to authenticated
  using (is_admin(tenant_id)) with check (is_admin(tenant_id));

create policy sales_select on public.sales for select to authenticated
  using (can_see_site(tenant_id, site_id));

create policy sessions_select on public.active_sessions for select to authenticated
  using (can_see_site(tenant_id, site_id));

-- Router secrets never reach the browser: column-level grant without secret_ciphertext.
revoke select on public.routers from anon, authenticated;
grant select (id, tenant_id, site_id, name, host, port, conn, tls, username,
              routeros_version, board_name, status, last_seen_at, last_error, created_at)
  on public.routers to authenticated;

-- ---------- Onboarding ----------------------------------------------
create or replace function public.create_tenant(p_name text, p_first_site text default 'HQ')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tenant uuid;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  insert into tenants (name) values (p_name) returning id into v_tenant;
  insert into memberships (tenant_id, user_id, role) values (v_tenant, auth.uid(), 'owner');
  insert into sites (tenant_id, name) values (v_tenant, p_first_site);
  return v_tenant;
end $$;

-- ---------- Voucher generation --------------------------------------
create or replace function public.generate_vouchers(
  p_plan_id  uuid,
  p_quantity int,
  p_prefix   text default '',
  p_length   int  default 8,
  p_charset  text default 'numeric'   -- 'numeric' | 'alnum'
) returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  v_plan     plans;
  v_batch    uuid;
  v_alphabet text;
  v_made     int := 0;
  v_tries    int := 0;
  v_code     text;
  v_bytes    bytea;
  i          int;
begin
  select * into v_plan from plans where id = p_plan_id;
  if not found then raise exception 'plan not found'; end if;
  if not is_admin(v_plan.tenant_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_quantity not between 1 and 2000 then raise exception 'quantity must be 1–2000'; end if;
  if p_length not between 6 and 16 then raise exception 'code length must be 6–16'; end if;

  v_alphabet := case p_charset
                  when 'numeric' then '0123456789'
                  when 'alnum'   then 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'  -- no 0/O/1/I/L
                  else null end;
  if v_alphabet is null then raise exception 'charset must be numeric or alnum'; end if;

  insert into voucher_batches (tenant_id, site_id, plan_id, quantity, prefix, charset)
  values (v_plan.tenant_id, v_plan.site_id, v_plan.id, p_quantity, upper(coalesce(p_prefix, '')), p_charset)
  returning id into v_batch;

  while v_made < p_quantity loop
    v_tries := v_tries + 1;
    if v_tries > p_quantity * 20 then raise exception 'code space exhausted; use a longer code'; end if;
    v_bytes := gen_random_bytes(p_length);
    v_code  := upper(coalesce(p_prefix, ''));
    for i in 0 .. p_length - 1 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % length(v_alphabet)) + 1, 1);
    end loop;
    insert into vouchers (tenant_id, site_id, plan_id, batch_id, code, password)
    values (v_plan.tenant_id, v_plan.site_id, v_plan.id, v_batch, v_code, v_code)
    on conflict (tenant_id, code) do nothing;
    if found then v_made := v_made + 1; end if;
  end loop;

  return v_batch;
end $$;

-- ---------- Selling --------------------------------------------------
create or replace function public.sell_voucher(
  p_plan_id    uuid,
  p_method     public.payment_method default 'cash',
  p_agent_code text default null,
  p_note       text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_plan  plans;
  v_v     vouchers;
  v_agent uuid;
begin
  select * into v_plan from plans where id = p_plan_id and active;
  if not found then raise exception 'plan not found or inactive'; end if;
  if not can_see_site(v_plan.tenant_id, v_plan.site_id) then
    raise exception 'not allowed at this site' using errcode = '42501';
  end if;

  if p_method = 'agent_code' then
    select id into v_agent from agents
     where tenant_id = v_plan.tenant_id and code = upper(trim(p_agent_code)) and active
       and (site_id is null or site_id = v_plan.site_id);
    if v_agent is null then raise exception 'unknown or inactive agent code'; end if;
  end if;

  select * into v_v from vouchers
   where plan_id = p_plan_id and status = 'unused' and pushed_at is not null
   order by created_at
   limit 1
   for update skip locked;
  if not found then
    raise exception 'no vouchers ready on the router for this plan — generate a batch and wait for sync';
  end if;

  update vouchers set status = 'sold', sold_at = now() where id = v_v.id;

  insert into sales (tenant_id, site_id, voucher_id, plan_id, amount, currency, method, agent_id, sold_by, note)
  values (v_plan.tenant_id, v_plan.site_id, v_v.id, v_plan.id, v_plan.price, v_plan.currency,
          p_method, v_agent, auth.uid(), p_note);

  return jsonb_build_object(
    'voucher_id', v_v.id, 'code', v_v.code, 'password', v_v.password,
    'plan', v_plan.name, 'amount', v_plan.price, 'currency', v_plan.currency,
    'uptime_seconds', v_plan.uptime_seconds);
end $$;

-- ---------- Expiry ---------------------------------------------------
create or replace function public.expire_vouchers()
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  update vouchers v
     set expires_at = v.first_login_at + make_interval(secs => p.validity_seconds)
    from plans p
   where p.id = v.plan_id and v.expires_at is null and v.first_login_at is not null
     and p.validity_seconds is not null;

  update vouchers v
     set status = 'expired', expired_at = now()
    from plans p
   where p.id = v.plan_id and v.status = 'active'
     and (v.uptime_used_seconds >= p.uptime_seconds
          or (p.bytes_limit is not null and v.bytes_used >= p.bytes_limit)
          or (v.expires_at is not null and v.expires_at <= now()));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------- Router sync (called by router API with service role) ----
-- p_users:  [{voucher_id, uptime, bytes}]
-- p_active: [{user, mac, address, uptime, bytes_in, bytes_out}]
create or replace function public.apply_router_usage(p_router_id uuid, p_users jsonb, p_active jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_router routers;
begin
  select * into v_router from routers where id = p_router_id;
  if not found then raise exception 'router not found'; end if;

  with u as (
    select (x->>'voucher_id')::uuid as id,
           coalesce((x->>'uptime')::int, 0) as up,
           coalesce((x->>'bytes')::bigint, 0) as b
      from jsonb_array_elements(coalesce(p_users, '[]'::jsonb)) x
  )
  update vouchers v
     set uptime_used_seconds = greatest(v.uptime_used_seconds, u.up),
         bytes_used          = greatest(v.bytes_used, u.b),
         first_login_at      = case when v.first_login_at is null and u.up > 0 then now() else v.first_login_at end,
         status              = case when v.status in ('unused', 'sold') and u.up > 0
                                    then 'active'::voucher_status else v.status end
    from u
   where v.id = u.id and v.site_id = v_router.site_id;

  -- Printed cards used without a "sell" click still count as cash sales.
  insert into sales (tenant_id, site_id, voucher_id, plan_id, amount, currency, method, sold_at, note)
  select v.tenant_id, v.site_id, v.id, v.plan_id, p.price, p.currency, 'cash',
         coalesce(v.first_login_at, now()), 'auto: recorded on first login'
    from vouchers v
    join plans p   on p.id = v.plan_id
    join tenants t on t.id = v.tenant_id
   where v.site_id = v_router.site_id and v.status = 'active' and t.auto_sale_on_activation
     and not exists (select 1 from sales s where s.voucher_id = v.id)
  on conflict (voucher_id) do nothing;

  update vouchers set sold_at = first_login_at
   where site_id = v_router.site_id and status = 'active' and sold_at is null;

  delete from active_sessions where router_id = p_router_id;
  insert into active_sessions (router_id, tenant_id, site_id, username, mac, address,
                               uptime_seconds, bytes_in, bytes_out, voucher_id)
  select p_router_id, v_router.tenant_id, v_router.site_id,
         x->>'user', coalesce(x->>'mac', ''), x->>'address',
         coalesce((x->>'uptime')::int, 0),
         coalesce((x->>'bytes_in')::bigint, 0),
         coalesce((x->>'bytes_out')::bigint, 0),
         (select id from vouchers where tenant_id = v_router.tenant_id and code = x->>'user')
    from jsonb_array_elements(coalesce(p_active, '[]'::jsonb)) x
   where coalesce(x->>'user', '') <> ''
  on conflict do nothing;

  return expire_vouchers();
end $$;

revoke execute on function public.apply_router_usage(uuid, jsonb, jsonb) from public, anon, authenticated;
grant  execute on function public.apply_router_usage(uuid, jsonb, jsonb) to service_role;
revoke execute on function public.expire_vouchers() from public, anon, authenticated;
grant  execute on function public.expire_vouchers() to service_role;

-- ---------- Reports --------------------------------------------------
create view public.v_sales_daily with (security_invoker = true) as
select s.tenant_id, s.site_id, si.name as site_name,
       (s.sold_at at time zone si.timezone)::date as day,
       s.plan_id, p.name as plan_name, s.method, s.agent_id, s.currency,
       count(*) as vouchers_sold, sum(s.amount) as revenue
  from sales s
  join sites si on si.id = s.site_id
  join plans p  on p.id = s.plan_id
 group by s.tenant_id, s.site_id, si.name, (s.sold_at at time zone si.timezone)::date,
          s.plan_id, p.name, s.method, s.agent_id, s.currency;

create view public.v_voucher_stock with (security_invoker = true) as
select v.tenant_id, v.site_id, v.plan_id, p.name as plan_name,
       count(*) filter (where v.status = 'unused' and v.pushed_at is not null) as ready,
       count(*) filter (where v.status = 'unused' and v.pushed_at is null)     as pending_push,
       count(*) filter (where v.status = 'sold')     as sold_not_used,
       count(*) filter (where v.status = 'active')   as active,
       count(*) filter (where v.status = 'expired')  as expired,
       count(*) filter (where v.status = 'disabled') as disabled
  from vouchers v join plans p on p.id = v.plan_id
 group by v.tenant_id, v.site_id, v.plan_id, p.name;

create view public.v_agent_commission with (security_invoker = true) as
select s.tenant_id, s.site_id, a.id as agent_id, a.name as agent_name, a.code,
       (s.sold_at at time zone si.timezone)::date as day, s.currency,
       count(*) as vouchers_sold, sum(s.amount) as revenue,
       round(sum(s.amount) * a.commission_pct / 100, 2) as commission
  from sales s
  join agents a on a.id = s.agent_id
  join sites si on si.id = s.site_id
 group by s.tenant_id, s.site_id, a.id, a.name, a.code, a.commission_pct,
          (s.sold_at at time zone si.timezone)::date, s.currency;

-- ---------- Realtime for live dashboards -----------------------------
alter publication supabase_realtime add table public.active_sessions, public.sales;

-- ---------- Optional: wall-clock expiry even when a router is offline ---
-- create extension if not exists pg_cron;
-- select cron.schedule('hzc-expire', '* * * * *', $$select public.expire_vouchers()$$);

-- >>> supabase/migrations/20261010000100_extensions.sql
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

