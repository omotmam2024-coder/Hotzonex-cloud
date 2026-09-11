-- =============================================================================
-- Locations, routers, credentials (deny-all), and the non-destructive mirror
-- of RouterOS state (interfaces, hotspot servers, hotspot user profiles).
--
-- MikroTik ID rule: a RouterOS internal id ("*1A") is unique only within one
-- router, so every mirror table is keyed by (router_id, mikrotik_id).
-- =============================================================================

create type public.location_status as enum ('active', 'inactive', 'maintenance');
create type public.router_status as enum ('online', 'offline', 'warning', 'critical', 'unknown');
create type public.api_protocol as enum ('api', 'api_ssl', 'rest');
create type public.credentials_status as enum ('not_set', 'pending', 'set', 'rejected');

-- -----------------------------------------------------------------------------
-- Locations
-- -----------------------------------------------------------------------------
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  address text check (char_length(address) <= 300),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  contact text check (char_length(contact) <= 200),
  opening_hours text check (char_length(opening_hours) <= 200),
  status public.location_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_coordinates_paired check ((lat is null) = (lng is null)),
  constraint locations_tenant_name_key unique (tenant_id, name),
  constraint locations_id_tenant_key unique (id, tenant_id)
);
create index locations_tenant_id_idx on public.locations (tenant_id);
create trigger locations_touch before update on public.locations
  for each row execute function app.touch_updated_at();

create function app.default_tenant() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.tenant_id is null then
    new.tenant_id := app.user_tenant_id();
  end if;
  return new;
end;
$$;
create trigger locations_default_tenant before insert on public.locations
  for each row execute function app.default_tenant();

alter table public.locations enable row level security;
revoke all on public.locations from anon, authenticated;
grant select, delete on public.locations to authenticated;
grant insert (tenant_id, name, address, lat, lng, contact, opening_hours, status) on public.locations to authenticated;
grant update (name, address, lat, lng, contact, opening_hours, status) on public.locations to authenticated;
grant all on public.locations to service_role;

create policy locations_select on public.locations for select to authenticated
  using ((select app.staff_in_tenant(tenant_id)));
create policy locations_insert on public.locations for insert to authenticated
  with check ((select app.admin_of(tenant_id)));
create policy locations_update on public.locations for update to authenticated
  using ((select app.admin_of(tenant_id)))
  with check ((select app.admin_of(tenant_id)));
create policy locations_delete on public.locations for delete to authenticated
  using ((select app.admin_of(tenant_id)));

-- -----------------------------------------------------------------------------
-- WireGuard tunnel address pool. One VPS WireGuard interface serves every
-- tenant, so addresses are globally unique. Server = 10.77.0.1; routers get
-- 10.77.x.y (never .0 or .255). Must match the connector's WG_INTERFACE
-- address — see docs/ROUTER_SETUP.md.
-- -----------------------------------------------------------------------------
create function app.wg_server_address() returns text
language sql immutable set search_path = '' as $$ select '10.77.0.1'::text $$;

-- SECURITY DEFINER: the pool is global, so allocation must see every tenant's
-- routers, which the caller's RLS view would hide. Used as a column default.
create function app.allocate_wg_address() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_offset int;
begin
  perform pg_advisory_xact_lock(hashtext('hotzonex.wg_address_pool'));
  select g into v_offset
    from generate_series(2, 65534) as g
   where g % 256 not in (0, 255)
     and not exists (
       select 1 from public.routers r
        where r.wg_address = '10.77.' || (g / 256)::text || '.' || (g % 256)::text)
   order by g
   limit 1;
  if v_offset is null then
    raise exception 'The WireGuard address pool 10.77.0.0/16 is exhausted.' using errcode = '53000', hint = 'pool_exhausted';
  end if;
  return '10.77.' || (v_offset / 256)::text || '.' || (v_offset % 256)::text;
end;
$$;

-- -----------------------------------------------------------------------------
-- Routers
-- -----------------------------------------------------------------------------
create table public.routers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  location_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- Address the connector dials: the router's tunnel IP, never its ISP address.
  -- The empty default is replaced with wg_address by the insert trigger.
  host text not null default '' check (host ~ '^\d{1,3}(\.\d{1,3}){3}$'),
  api_protocol public.api_protocol not null default 'api',
  api_port integer not null default 8728 check (api_port between 1 and 65535),
  use_ssl boolean not null default false,
  wg_public_key text check (wg_public_key ~ '^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$'),
  wg_address text not null default app.allocate_wg_address() check (wg_address ~ '^10\.77\.\d{1,3}\.\d{1,3}$'),
  wg_last_handshake_at timestamptz,
  status public.router_status not null default 'unknown',
  status_reason text check (char_length(status_reason) <= 300),
  last_seen_at timestamptz,
  last_polled_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  identity text check (char_length(identity) <= 120),
  board_name text check (char_length(board_name) <= 120),
  architecture text check (char_length(architecture) <= 40),
  routeros_version text check (char_length(routeros_version) <= 40),
  -- Latest poll snapshot, so list pages need no time-series scan.
  uptime_seconds bigint,
  cpu_load smallint check (cpu_load between 0 and 100),
  free_memory bigint,
  total_memory bigint,
  credentials_status public.credentials_status not null default 'not_set',
  credentials_updated_at timestamptz,
  hotspot_server_id uuid,
  default_hotspot_profile_id uuid,
  discovered_at timestamptz,
  onboarding_completed_at timestamptz,
  is_demo boolean not null default false,
  notes text check (char_length(notes) <= 2000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint routers_id_tenant_key unique (id, tenant_id),
  constraint routers_wg_address_key unique (wg_address),
  constraint routers_wg_public_key_key unique (wg_public_key),
  constraint routers_tenant_name_key unique (tenant_id, name),
  constraint routers_location_same_tenant foreign key (location_id, tenant_id)
    references public.locations (id, tenant_id) on delete set null (location_id),
  constraint routers_protocol_tls check (
    (api_protocol = 'api' and not use_ssl) or (api_protocol = 'api_ssl' and use_ssl) or api_protocol = 'rest')
);
create index routers_tenant_id_idx on public.routers (tenant_id);
create index routers_location_id_idx on public.routers (location_id);
create index routers_status_idx on public.routers (tenant_id, status);
create index routers_poll_idx on public.routers (last_polled_at nulls first) where credentials_status = 'set';
create trigger routers_touch before update on public.routers
  for each row execute function app.touch_updated_at();

create function app.routers_before_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.tenant_id is null then new.tenant_id := app.user_tenant_id(); end if;
  if new.host is null or new.host = '' then new.host := new.wg_address; end if;
  if new.created_by is null then new.created_by := auth.uid(); end if;
  return new;
end;
$$;
create trigger routers_before_insert before insert on public.routers
  for each row execute function app.routers_before_insert();

-- -----------------------------------------------------------------------------
-- Mirror tables (written only by the connector via service role)
-- -----------------------------------------------------------------------------
create table public.router_interfaces (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  router_id uuid not null,
  mikrotik_id text not null check (char_length(mikrotik_id) between 1 and 32),
  name text not null,
  type text not null,
  mac text,
  running boolean not null default false,
  disabled boolean not null default false,
  rx_bytes bigint not null default 0,
  tx_bytes bigint not null default 0,
  mtu integer,
  comment text,
  synced_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint router_interfaces_router_mikrotik_key unique (router_id, mikrotik_id),
  constraint router_interfaces_router_fk foreign key (router_id, tenant_id)
    references public.routers (id, tenant_id) on delete cascade
);
create index router_interfaces_tenant_id_idx on public.router_interfaces (tenant_id);

create table public.hotspot_servers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  router_id uuid not null,
  mikrotik_id text not null check (char_length(mikrotik_id) between 1 and 32),
  name text not null,
  interface text,
  address_pool text,
  profile text,
  disabled boolean not null default false,
  invalid boolean not null default false,
  first_seen_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint hotspot_servers_router_mikrotik_key unique (router_id, mikrotik_id),
  constraint hotspot_servers_id_router_key unique (id, router_id),
  constraint hotspot_servers_router_fk foreign key (router_id, tenant_id)
    references public.routers (id, tenant_id) on delete cascade
);
create index hotspot_servers_tenant_id_idx on public.hotspot_servers (tenant_id);

create table public.hotspot_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  router_id uuid not null,
  mikrotik_id text not null check (char_length(mikrotik_id) between 1 and 32),
  name text not null,
  rate_limit text,
  shared_users integer,
  session_timeout_seconds bigint,
  idle_timeout_seconds bigint,
  keepalive_timeout_seconds bigint,
  address_pool text,
  is_default boolean not null default false,
  first_seen_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint hotspot_profiles_router_mikrotik_key unique (router_id, mikrotik_id),
  constraint hotspot_profiles_id_router_key unique (id, router_id),
  constraint hotspot_profiles_router_fk foreign key (router_id, tenant_id)
    references public.routers (id, tenant_id) on delete cascade
);
create index hotspot_profiles_tenant_id_idx on public.hotspot_profiles (tenant_id);

-- The selected hotspot server / default profile must belong to the same router.
alter table public.routers
  add constraint routers_hotspot_server_same_router foreign key (hotspot_server_id, id)
    references public.hotspot_servers (id, router_id) on delete set null (hotspot_server_id),
  add constraint routers_default_profile_same_router foreign key (default_hotspot_profile_id, id)
    references public.hotspot_profiles (id, router_id) on delete set null (default_hotspot_profile_id);

create table public.router_metrics (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  router_id uuid not null,
  captured_at timestamptz not null default now(),
  reachable boolean not null,
  latency_ms integer,
  cpu_load smallint check (cpu_load between 0 and 100),
  free_memory bigint,
  total_memory bigint,
  uptime_seconds bigint,
  health jsonb,
  error_code text,
  constraint router_metrics_router_fk foreign key (router_id, tenant_id)
    references public.routers (id, tenant_id) on delete cascade
);
create index router_metrics_router_captured_idx on public.router_metrics (router_id, captured_at desc);
create index router_metrics_tenant_id_idx on public.router_metrics (tenant_id);

-- Where RouterOS and Hotzonex disagree. Recorded, shown, never auto-resolved.
create table public.sync_drift (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  router_id uuid not null,
  entity_type text not null check (entity_type in ('router', 'hotspot_server', 'hotspot_profile')),
  mikrotik_id text,
  field text not null,
  expected jsonb,
  actual jsonb,
  message text not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  constraint sync_drift_router_fk foreign key (router_id, tenant_id)
    references public.routers (id, tenant_id) on delete cascade
);
create index sync_drift_tenant_id_idx on public.sync_drift (tenant_id);
create unique index sync_drift_open_key on public.sync_drift (router_id, entity_type, coalesce(mikrotik_id, ''), field)
  where resolved_at is null;

-- -----------------------------------------------------------------------------
-- Credentials. Deny-all: RLS enabled with no policies, and no grants to API
-- roles. Only the connector (service role) reads or writes them, and it holds
-- the only decryption key. Browsers submit credentials sealed to the
-- connector's public key through submit_router_credentials().
-- -----------------------------------------------------------------------------
create table public.router_credentials (
  router_id uuid primary key,
  tenant_id uuid not null,
  username text not null,
  password_ciphertext text not null,
  key_version integer not null check (key_version > 0),
  updated_at timestamptz not null default now(),
  constraint router_credentials_router_fk foreign key (router_id, tenant_id)
    references public.routers (id, tenant_id) on delete cascade
);
create index router_credentials_tenant_id_idx on public.router_credentials (tenant_id);

create table public.router_credential_submissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  router_id uuid not null,
  sealed jsonb not null,
  submitted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint router_credential_submissions_router_fk foreign key (router_id, tenant_id)
    references public.routers (id, tenant_id) on delete cascade
);
create index router_credential_submissions_tenant_id_idx on public.router_credential_submissions (tenant_id);

alter table public.router_credentials enable row level security;
alter table public.router_credential_submissions enable row level security;
revoke all on public.router_credentials from public, anon, authenticated;
revoke all on public.router_credential_submissions from public, anon, authenticated;
grant all on public.router_credentials, public.router_credential_submissions to service_role;

-- -----------------------------------------------------------------------------
-- Router & mirror privileges and RLS
-- -----------------------------------------------------------------------------
alter table public.routers enable row level security;
alter table public.router_interfaces enable row level security;
alter table public.hotspot_servers enable row level security;
alter table public.hotspot_profiles enable row level security;
alter table public.router_metrics enable row level security;
alter table public.sync_drift enable row level security;

revoke all on public.routers, public.router_interfaces, public.hotspot_servers, public.hotspot_profiles,
              public.router_metrics, public.sync_drift from anon, authenticated;
grant all on public.routers, public.router_interfaces, public.hotspot_servers, public.hotspot_profiles,
             public.router_metrics, public.sync_drift to service_role;

-- Users may set only the fields they own. Status, telemetry, discovery results,
-- tunnel addresses and credential state are connector-owned.
grant select, delete on public.routers to authenticated;
grant insert (tenant_id, location_id, name, api_protocol, api_port, use_ssl, notes) on public.routers to authenticated;
grant update (location_id, name, api_protocol, api_port, use_ssl, wg_public_key, hotspot_server_id,
              default_hotspot_profile_id, onboarding_completed_at, notes) on public.routers to authenticated;

create policy routers_select on public.routers for select to authenticated
  using ((select app.staff_in_tenant(tenant_id)));
create policy routers_insert on public.routers for insert to authenticated
  with check ((select app.operator_of(tenant_id)) and not is_demo);
create policy routers_update on public.routers for update to authenticated
  using ((select app.operator_of(tenant_id)))
  with check ((select app.operator_of(tenant_id)));
-- TECHNICIAN cannot delete routers.
create policy routers_delete on public.routers for delete to authenticated
  using ((select app.admin_of(tenant_id)));

grant select on public.router_interfaces, public.hotspot_servers, public.hotspot_profiles,
                public.router_metrics, public.sync_drift to authenticated;

create policy router_interfaces_select on public.router_interfaces for select to authenticated
  using ((select app.staff_in_tenant(tenant_id)));
create policy hotspot_servers_select on public.hotspot_servers for select to authenticated
  using ((select app.staff_in_tenant(tenant_id)));
create policy hotspot_profiles_select on public.hotspot_profiles for select to authenticated
  using ((select app.staff_in_tenant(tenant_id)));
create policy router_metrics_select on public.router_metrics for select to authenticated
  using ((select app.staff_in_tenant(tenant_id)));
create policy sync_drift_select on public.sync_drift for select to authenticated
  using ((select app.staff_in_tenant(tenant_id)));

-- Acknowledge a drift entry. Never touches the router; it only records that a human saw it.
create function public.resolve_drift(p_drift_id uuid) returns public.sync_drift
language plpgsql security definer set search_path = '' as $$
declare v_row public.sync_drift;
begin
  select * into v_row from public.sync_drift where id = p_drift_id;
  if not found or not app.operator_of(v_row.tenant_id) then
    raise exception 'Drift entry not found.' using errcode = 'P0002', hint = 'not_found';
  end if;
  update public.sync_drift set resolved_at = now(), resolved_by = auth.uid()
   where id = p_drift_id and resolved_at is null
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.resolve_drift(uuid) from public, anon;
grant execute on function public.resolve_drift(uuid) to authenticated;

-- 7-day uptime per router, bucketed. SECURITY INVOKER: RLS on router_metrics applies.
create function public.router_uptime_buckets(p_days integer default 7, p_bucket_hours integer default 6)
returns table (router_id uuid, bucket_start timestamptz, samples integer, reachable_samples integer)
language sql stable security invoker set search_path = '' as $$
  with params as (
    select least(greatest(coalesce(p_days, 7), 1), 31) as days,
           least(greatest(coalesce(p_bucket_hours, 6), 1), 24) * 3600 as bucket_secs
  )
  select m.router_id,
         to_timestamp(floor(extract(epoch from m.captured_at) / p.bucket_secs) * p.bucket_secs) as bucket_start,
         count(*)::integer as samples,
         (count(*) filter (where m.reachable))::integer as reachable_samples
    from public.router_metrics m, params p
   where m.captured_at >= now() - make_interval(days => p.days)
   group by m.router_id, 2
   order by m.router_id, 2
$$;
revoke all on function public.router_uptime_buckets(integer, integer) from public, anon;
grant execute on function public.router_uptime_buckets(integer, integer) to authenticated;

revoke all on function app.allocate_wg_address() from public;
grant execute on function app.allocate_wg_address() to authenticated, service_role;
