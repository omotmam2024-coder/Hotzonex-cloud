-- =============================================================================
-- Control-plane API. The connector (service role) does all its reading and
-- writing through these functions, so the job lifecycle, non-destructive sync
-- and drift detection are enforced in one place and exercised by the same
-- tests whether the database is local Postgres or Supabase.
--
-- None of these functions is callable by anon or authenticated users.
-- =============================================================================

create table public.connector_status (
  connector_id text primary key check (connector_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  version text check (char_length(version) <= 40),
  provider_mode text not null check (provider_mode in ('mock', 'api', 'rest')),
  sealing_key_id text not null check (sealing_key_id ~ '^[0-9a-f]{16,64}$'),
  -- Public half of the P-256 key browsers seal router credentials to. JWK, public members only.
  sealing_public_key jsonb not null check (
    sealing_public_key ->> 'kty' = 'EC' and sealing_public_key ->> 'crv' = 'P-256'
    and not sealing_public_key ? 'd'),
  wg_server_public_key text check (wg_server_public_key ~ '^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$'),
  wg_endpoint text check (char_length(wg_endpoint) <= 260),
  wg_server_address text check (wg_server_address ~ '^\d{1,3}(\.\d{1,3}){3}$'),
  started_at timestamptz not null,
  last_heartbeat_at timestamptz not null
);
alter table public.connector_status enable row level security;
revoke all on public.connector_status from anon, authenticated;
grant select on public.connector_status to authenticated;
grant all on public.connector_status to service_role;
-- Global infrastructure (no tenant data): every staff member may see whether the connector is alive.
create policy connector_status_select on public.connector_status for select to authenticated
  using ((select app.is_staff()));

-- -----------------------------------------------------------------------------
-- Heartbeat
-- -----------------------------------------------------------------------------
create function public.connector_heartbeat(p_connector_id text, p_info jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.connector_status as c (connector_id, version, provider_mode, sealing_key_id, sealing_public_key,
                                            wg_server_public_key, wg_endpoint, wg_server_address, started_at, last_heartbeat_at)
  values (p_connector_id, p_info ->> 'version', p_info ->> 'provider_mode', p_info ->> 'sealing_key_id',
          p_info -> 'sealing_public_key', p_info ->> 'wg_server_public_key', p_info ->> 'wg_endpoint',
          p_info ->> 'wg_server_address', coalesce((p_info ->> 'started_at')::timestamptz, now()), now())
  on conflict (connector_id) do update set
    version = excluded.version,
    provider_mode = excluded.provider_mode,
    sealing_key_id = excluded.sealing_key_id,
    sealing_public_key = excluded.sealing_public_key,
    wg_server_public_key = excluded.wg_server_public_key,
    wg_endpoint = excluded.wg_endpoint,
    wg_server_address = excluded.wg_server_address,
    started_at = excluded.started_at,
    last_heartbeat_at = now();
end;
$$;

-- -----------------------------------------------------------------------------
-- Job lifecycle
-- -----------------------------------------------------------------------------
create function public.connector_claim_jobs(p_connector_id text, p_limit integer, p_lease_seconds integer)
returns setof public.jobs
language plpgsql security definer set search_path = '' as $$
begin
  -- Jobs that waited out their window for an offline router.
  update public.jobs
     set status = 'dead', finished_at = now(), last_error_code = 'EXPIRED',
         last_error = 'The router did not become reachable before this job expired.'
   where status = 'pending' and expires_at <= now();

  return query
    update public.jobs j
       set status = 'claimed', claimed_by = p_connector_id, claimed_at = now()
     where j.id in (
       select q.id from public.jobs q
        where (q.status = 'pending' and q.run_after <= now())
           or (q.status in ('claimed', 'running')
               and q.claimed_at < now() - make_interval(secs => greatest(p_lease_seconds, 30)))
        order by q.run_after, q.created_at
        limit greatest(1, least(coalesce(p_limit, 10), 100))
        for update skip locked)
    returning j.*;
end;
$$;

-- Marks the start of an execution attempt. Returns no row if this connector lost the claim.
create function public.connector_start_job(p_job_id uuid, p_connector_id text)
returns setof public.jobs
language sql security definer set search_path = '' as $$
  update public.jobs
     set status = 'running', attempts = attempts + 1, started_at = now(), claimed_at = now()
   where id = p_job_id and claimed_by = p_connector_id and status in ('claimed', 'running')
  returning *;
$$;

-- outcome: succeeded | retry | defer | failed | dead
create function public.connector_finish_job(
  p_job_id uuid, p_connector_id text, p_outcome text,
  p_result jsonb default null, p_error_code text default null, p_error text default null,
  p_run_after timestamptz default null, p_refund_attempt boolean default false
) returns setof public.jobs
language plpgsql security definer set search_path = '' as $$
begin
  if p_outcome not in ('succeeded', 'retry', 'defer', 'failed', 'dead') then
    raise exception 'unknown outcome %', p_outcome using errcode = '22023';
  end if;
  return query
    update public.jobs
       set status = case p_outcome
                      when 'succeeded' then 'succeeded'::public.job_status
                      when 'failed' then 'failed'::public.job_status
                      when 'dead' then 'dead'::public.job_status
                      else 'pending'::public.job_status end,
           result = case when p_outcome = 'succeeded' then p_result else result end,
           last_error_code = case when p_outcome = 'succeeded' then null else left(p_error_code, 40) end,
           last_error = case when p_outcome = 'succeeded' then null else left(p_error, 1000) end,
           finished_at = case when p_outcome in ('succeeded', 'failed', 'dead') then now() else null end,
           run_after = case when p_outcome in ('retry', 'defer') then coalesce(p_run_after, now()) else run_after end,
           claimed_by = case when p_outcome in ('retry', 'defer') then null else claimed_by end,
           claimed_at = case when p_outcome in ('retry', 'defer') then null else claimed_at end,
           deferrals = deferrals + case when p_outcome = 'defer' then 1 else 0 end,
           attempts = greatest(attempts - case when p_outcome = 'defer' and p_refund_attempt then 1 else 0 end, 0)
     where id = p_job_id and claimed_by = p_connector_id and status in ('claimed', 'running')
    returning *;
end;
$$;

-- Router came back: run its deferred jobs now instead of waiting out their backoff.
create function public.connector_release_router_jobs(p_router_id uuid) returns integer
language sql security definer set search_path = '' as $$
  with released as (
    update public.jobs set run_after = now()
     where router_id = p_router_id and status = 'pending' and run_after > now()
    returning 1)
  select count(*)::integer from released;
$$;

-- -----------------------------------------------------------------------------
-- Router reads for the connector (includes ciphertext — service role only)
-- -----------------------------------------------------------------------------
create function public.connector_get_router(p_router_id uuid)
returns table (
  id uuid, tenant_id uuid, name text, host text, api_protocol public.api_protocol, api_port integer,
  use_ssl boolean, is_demo boolean, status public.router_status, consecutive_failures integer,
  credentials_status public.credentials_status, wg_public_key text, wg_last_handshake_at timestamptz,
  hotspot_server_id uuid, default_hotspot_profile_id uuid,
  username text, password_ciphertext text, key_version integer
)
language sql stable security definer set search_path = '' as $$
  select r.id, r.tenant_id, r.name, r.host, r.api_protocol, r.api_port, r.use_ssl, r.is_demo, r.status,
         r.consecutive_failures, r.credentials_status, r.wg_public_key, r.wg_last_handshake_at,
         r.hotspot_server_id, r.default_hotspot_profile_id, c.username, c.password_ciphertext, c.key_version
    from public.routers r
    left join public.router_credentials c on c.router_id = r.id
   where r.id = p_router_id;
$$;

-- Routers whose health poll is due. Interval: tenant setting, else the connector default.
create function public.connector_routers_due(p_default_interval_seconds integer, p_limit integer)
returns table (
  id uuid, tenant_id uuid, name text, host text, api_protocol public.api_protocol, api_port integer,
  use_ssl boolean, is_demo boolean, status public.router_status, consecutive_failures integer,
  last_polled_at timestamptz, poll_interval_seconds integer, offline_after_missed_polls integer,
  username text, password_ciphertext text, key_version integer
)
language sql stable security definer set search_path = '' as $$
  with cfg as (
    select r.*,
           coalesce((select (s.value #>> '{}')::integer from public.system_settings s
                      where s.tenant_id = r.tenant_id and s.key = 'health_poll_interval_seconds'),
                    greatest(p_default_interval_seconds, 60)) as poll_interval,
           coalesce((select (s.value #>> '{}')::integer from public.system_settings s
                      where s.tenant_id = r.tenant_id and s.key = 'offline_after_missed_polls'), 2) as offline_after
      from public.routers r
     where r.credentials_status = 'set' or r.is_demo
  )
  select cfg.id, cfg.tenant_id, cfg.name, cfg.host, cfg.api_protocol, cfg.api_port, cfg.use_ssl, cfg.is_demo,
         cfg.status, cfg.consecutive_failures, cfg.last_polled_at, cfg.poll_interval, cfg.offline_after,
         c.username, c.password_ciphertext, c.key_version
    from cfg
    -- Demo routers have no credentials; the connector always serves them from the mock provider.
    left join public.router_credentials c on c.router_id = cfg.id
   where (c.router_id is not null or cfg.is_demo)
     and (cfg.last_polled_at is null or cfg.last_polled_at <= now() - make_interval(secs => cfg.poll_interval))
   order by cfg.last_polled_at nulls first
   limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

-- -----------------------------------------------------------------------------
-- Health poll result. The connector decides the status (it knows thresholds
-- and the consecutive-failure rule); the database records it. last_seen_at
-- only moves on success, so an OFFLINE router keeps its last contact time.
-- -----------------------------------------------------------------------------
create function public.connector_record_poll(
  p_router_id uuid, p_reachable boolean, p_status public.router_status,
  p_metrics jsonb default '{}'::jsonb, p_error_code text default null, p_error_detail text default null
) returns table (previous_status public.router_status, new_status public.router_status)
language plpgsql security definer set search_path = '' as $$
declare
  v_router public.routers;
  m jsonb := coalesce(p_metrics, '{}'::jsonb);
begin
  select * into v_router from public.routers where id = p_router_id for update;
  if not found then return; end if;

  insert into public.router_metrics (tenant_id, router_id, reachable, latency_ms, cpu_load, free_memory,
                                     total_memory, uptime_seconds, health, error_code)
  values (v_router.tenant_id, p_router_id, p_reachable, (m ->> 'latency_ms')::integer, (m ->> 'cpu_load')::smallint,
          (m ->> 'free_memory')::bigint, (m ->> 'total_memory')::bigint, (m ->> 'uptime_seconds')::bigint,
          m -> 'health', left(p_error_code, 40));

  update public.routers set
    status = p_status,
    status_reason = case when p_reachable and p_status = 'online' then null
                         else left(coalesce(p_error_code || coalesce(': ' || p_error_detail, ''), m ->> 'status_reason'), 300) end,
    last_polled_at = now(),
    last_seen_at = case when p_reachable then now() else last_seen_at end,
    consecutive_failures = case when p_reachable then 0 else consecutive_failures + 1 end,
    cpu_load = case when p_reachable then (m ->> 'cpu_load')::smallint else cpu_load end,
    free_memory = case when p_reachable then (m ->> 'free_memory')::bigint else free_memory end,
    total_memory = case when p_reachable then (m ->> 'total_memory')::bigint else total_memory end,
    uptime_seconds = case when p_reachable then (m ->> 'uptime_seconds')::bigint else uptime_seconds end,
    routeros_version = case when p_reachable then coalesce(m ->> 'routeros_version', routeros_version) else routeros_version end,
    board_name = case when p_reachable then coalesce(m ->> 'board_name', board_name) else board_name end,
    architecture = case when p_reachable then coalesce(m ->> 'architecture', architecture) else architecture end
  where id = p_router_id;

  return query select v_router.status, p_status;
end;
$$;

-- -----------------------------------------------------------------------------
-- Non-destructive sync. Mirrors RouterOS state keyed by (router_id,
-- mikrotik_id). Items that disappear from the router are marked removed_at,
-- never deleted. Where the router no longer matches what Hotzonex relies on
-- (selected hotspot server, default profile), a drift entry is recorded and
-- left for a human; nothing is auto-resolved, and nothing is written to the router.
-- -----------------------------------------------------------------------------
create function app.record_drift(
  p_tenant uuid, p_router uuid, p_entity text, p_mikrotik_id text, p_field text,
  p_expected jsonb, p_actual jsonb, p_message text
) returns integer
language plpgsql set search_path = '' as $$
declare v_count integer;
begin
  insert into public.sync_drift (tenant_id, router_id, entity_type, mikrotik_id, field, expected, actual, message)
  values (p_tenant, p_router, p_entity, p_mikrotik_id, p_field, p_expected, p_actual, p_message)
  on conflict (router_id, entity_type, coalesce(mikrotik_id, ''), field) where resolved_at is null do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function app.record_drift(uuid, uuid, text, text, text, jsonb, jsonb, text) from public;

create function public.connector_apply_sync(p_router_id uuid, p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_router public.routers;
  s jsonb := p_snapshot;
  r record;
  v_existing record;
  v_now timestamptz := now();
  v_ids text[];
  c_if jsonb := '{"added":0,"updated":0,"removed":0,"unchanged":0}';
  c_hs jsonb := '{"added":0,"updated":0,"removed":0,"unchanged":0}';
  c_hp jsonb := '{"added":0,"updated":0,"removed":0,"unchanged":0}';
  v_drift integer := 0;
  v_sel record;
begin
  select * into v_router from public.routers where id = p_router_id for update;
  if not found then
    raise exception 'router % not found', p_router_id using errcode = 'P0002';
  end if;
  if jsonb_typeof(s -> 'interfaces') <> 'array' or jsonb_typeof(s -> 'hotspot_servers') <> 'array'
     or jsonb_typeof(s -> 'hotspot_profiles') <> 'array' then
    raise exception 'sync snapshot is missing lists' using errcode = '22023';
  end if;

  -- Router facts
  update public.routers set
    identity = coalesce(s ->> 'identity', identity),
    routeros_version = coalesce(s ->> 'routeros_version', routeros_version),
    board_name = coalesce(s ->> 'board_name', board_name),
    architecture = coalesce(s ->> 'architecture', architecture),
    uptime_seconds = coalesce((s #>> '{resource,uptime_seconds}')::bigint, uptime_seconds),
    cpu_load = coalesce((s #>> '{resource,cpu_load}')::smallint, cpu_load),
    free_memory = coalesce((s #>> '{resource,free_memory}')::bigint, free_memory),
    total_memory = coalesce((s #>> '{resource,total_memory}')::bigint, total_memory),
    last_seen_at = v_now,
    discovered_at = v_now,
    status = case when status in ('offline', 'unknown') then 'online'::public.router_status else status end,
    status_reason = case when status in ('offline', 'unknown') then null else status_reason end,
    consecutive_failures = 0
  where id = p_router_id;

  -- Interfaces
  v_ids := array[]::text[];
  for r in select * from jsonb_to_recordset(s -> 'interfaces') as x(
      mikrotik_id text, name text, type text, mac text, running boolean, disabled boolean,
      rx_bytes bigint, tx_bytes bigint, mtu integer, comment text)
  loop
    v_ids := v_ids || r.mikrotik_id;
    select * into v_existing from public.router_interfaces where router_id = p_router_id and mikrotik_id = r.mikrotik_id;
    if not found then
      insert into public.router_interfaces (tenant_id, router_id, mikrotik_id, name, type, mac, running, disabled,
                                            rx_bytes, tx_bytes, mtu, comment, synced_at)
      values (v_router.tenant_id, p_router_id, r.mikrotik_id, r.name, coalesce(r.type, 'unknown'), r.mac,
              coalesce(r.running, false), coalesce(r.disabled, false), coalesce(r.rx_bytes, 0), coalesce(r.tx_bytes, 0),
              r.mtu, r.comment, v_now);
      c_if := jsonb_set(c_if, '{added}', to_jsonb((c_if ->> 'added')::int + 1));
    else
      if (v_existing.name, v_existing.type, v_existing.mac, v_existing.running, v_existing.disabled, v_existing.mtu,
          v_existing.comment, v_existing.removed_at is null)
         is distinct from (r.name, coalesce(r.type, 'unknown'), r.mac, coalesce(r.running, false),
                           coalesce(r.disabled, false), r.mtu, r.comment, true) then
        c_if := jsonb_set(c_if, '{updated}', to_jsonb((c_if ->> 'updated')::int + 1));
      else
        c_if := jsonb_set(c_if, '{unchanged}', to_jsonb((c_if ->> 'unchanged')::int + 1));
      end if;
      update public.router_interfaces set name = r.name, type = coalesce(r.type, 'unknown'), mac = r.mac,
             running = coalesce(r.running, false), disabled = coalesce(r.disabled, false),
             rx_bytes = coalesce(r.rx_bytes, 0), tx_bytes = coalesce(r.tx_bytes, 0), mtu = r.mtu,
             comment = r.comment, synced_at = v_now, removed_at = null
       where id = v_existing.id;
    end if;
  end loop;
  with gone as (
    update public.router_interfaces set removed_at = v_now
     where router_id = p_router_id and removed_at is null and not (mikrotik_id = any (v_ids))
    returning 1)
  select jsonb_set(c_if, '{removed}', to_jsonb(count(*)::int)) into c_if from gone;

  -- Hotspot servers
  v_ids := array[]::text[];
  for r in select * from jsonb_to_recordset(s -> 'hotspot_servers') as x(
      mikrotik_id text, name text, interface text, address_pool text, profile text, disabled boolean, invalid boolean)
  loop
    v_ids := v_ids || r.mikrotik_id;
    select * into v_existing from public.hotspot_servers where router_id = p_router_id and mikrotik_id = r.mikrotik_id;
    if not found then
      insert into public.hotspot_servers (tenant_id, router_id, mikrotik_id, name, interface, address_pool, profile,
                                          disabled, invalid, synced_at)
      values (v_router.tenant_id, p_router_id, r.mikrotik_id, r.name, r.interface, r.address_pool, r.profile,
              coalesce(r.disabled, false), coalesce(r.invalid, false), v_now);
      c_hs := jsonb_set(c_hs, '{added}', to_jsonb((c_hs ->> 'added')::int + 1));
    else
      if (v_existing.name, v_existing.interface, v_existing.address_pool, v_existing.profile, v_existing.disabled,
          v_existing.invalid, v_existing.removed_at is null)
         is distinct from (r.name, r.interface, r.address_pool, r.profile, coalesce(r.disabled, false),
                           coalesce(r.invalid, false), true) then
        c_hs := jsonb_set(c_hs, '{updated}', to_jsonb((c_hs ->> 'updated')::int + 1));
      else
        c_hs := jsonb_set(c_hs, '{unchanged}', to_jsonb((c_hs ->> 'unchanged')::int + 1));
      end if;
      update public.hotspot_servers set name = r.name, interface = r.interface, address_pool = r.address_pool,
             profile = r.profile, disabled = coalesce(r.disabled, false), invalid = coalesce(r.invalid, false),
             synced_at = v_now, removed_at = null
       where id = v_existing.id;
    end if;
  end loop;
  with gone as (
    update public.hotspot_servers set removed_at = v_now
     where router_id = p_router_id and removed_at is null and not (mikrotik_id = any (v_ids))
    returning 1)
  select jsonb_set(c_hs, '{removed}', to_jsonb(count(*)::int)) into c_hs from gone;

  -- Hotspot user profiles
  v_ids := array[]::text[];
  for r in select * from jsonb_to_recordset(s -> 'hotspot_profiles') as x(
      mikrotik_id text, name text, rate_limit text, shared_users integer, session_timeout_seconds bigint,
      idle_timeout_seconds bigint, keepalive_timeout_seconds bigint, address_pool text, is_default boolean)
  loop
    v_ids := v_ids || r.mikrotik_id;
    select * into v_existing from public.hotspot_profiles where router_id = p_router_id and mikrotik_id = r.mikrotik_id;
    if not found then
      insert into public.hotspot_profiles (tenant_id, router_id, mikrotik_id, name, rate_limit, shared_users,
                                           session_timeout_seconds, idle_timeout_seconds, keepalive_timeout_seconds,
                                           address_pool, is_default, synced_at)
      values (v_router.tenant_id, p_router_id, r.mikrotik_id, r.name, r.rate_limit, r.shared_users,
              r.session_timeout_seconds, r.idle_timeout_seconds, r.keepalive_timeout_seconds, r.address_pool,
              coalesce(r.is_default, false), v_now);
      c_hp := jsonb_set(c_hp, '{added}', to_jsonb((c_hp ->> 'added')::int + 1));
    else
      if (v_existing.name, v_existing.rate_limit, v_existing.shared_users, v_existing.session_timeout_seconds,
          v_existing.idle_timeout_seconds, v_existing.keepalive_timeout_seconds, v_existing.address_pool,
          v_existing.is_default, v_existing.removed_at is null)
         is distinct from (r.name, r.rate_limit, r.shared_users, r.session_timeout_seconds, r.idle_timeout_seconds,
                           r.keepalive_timeout_seconds, r.address_pool, coalesce(r.is_default, false), true) then
        c_hp := jsonb_set(c_hp, '{updated}', to_jsonb((c_hp ->> 'updated')::int + 1));
      else
        c_hp := jsonb_set(c_hp, '{unchanged}', to_jsonb((c_hp ->> 'unchanged')::int + 1));
      end if;
      update public.hotspot_profiles set name = r.name, rate_limit = r.rate_limit, shared_users = r.shared_users,
             session_timeout_seconds = r.session_timeout_seconds, idle_timeout_seconds = r.idle_timeout_seconds,
             keepalive_timeout_seconds = r.keepalive_timeout_seconds, address_pool = r.address_pool,
             is_default = coalesce(r.is_default, false), synced_at = v_now, removed_at = null
       where id = v_existing.id;
    end if;
  end loop;
  with gone as (
    update public.hotspot_profiles set removed_at = v_now
     where router_id = p_router_id and removed_at is null and not (mikrotik_id = any (v_ids))
    returning 1)
  select jsonb_set(c_hp, '{removed}', to_jsonb(count(*)::int)) into c_hp from gone;

  -- Drift: what Hotzonex relies on no longer matches the router.
  if v_router.hotspot_server_id is not null then
    select * into v_sel from public.hotspot_servers where id = v_router.hotspot_server_id;
    if v_sel.removed_at is not null then
      v_drift := v_drift + app.record_drift(v_router.tenant_id, p_router_id, 'hotspot_server', v_sel.mikrotik_id, 'presence',
        to_jsonb(v_sel.name), 'null'::jsonb,
        format('The selected hotspot server "%s" no longer exists on the router.', v_sel.name));
    elsif v_sel.disabled or v_sel.invalid then
      v_drift := v_drift + app.record_drift(v_router.tenant_id, p_router_id, 'hotspot_server', v_sel.mikrotik_id, 'state',
        '"enabled"'::jsonb, to_jsonb(case when v_sel.invalid then 'invalid' else 'disabled' end),
        format('The selected hotspot server "%s" is %s on the router.', v_sel.name,
               case when v_sel.invalid then 'marked invalid' else 'disabled' end));
    end if;
  end if;
  if v_router.default_hotspot_profile_id is not null then
    select * into v_sel from public.hotspot_profiles where id = v_router.default_hotspot_profile_id;
    if v_sel.removed_at is not null then
      v_drift := v_drift + app.record_drift(v_router.tenant_id, p_router_id, 'hotspot_profile', v_sel.mikrotik_id, 'presence',
        to_jsonb(v_sel.name), 'null'::jsonb,
        format('The default hotspot profile "%s" no longer exists on the router.', v_sel.name));
    end if;
  end if;

  return jsonb_build_object('interfaces', c_if, 'hotspot_servers', c_hs, 'hotspot_profiles', c_hp, 'drift_recorded', v_drift);
end;
$$;

-- Rename drift: a sync that renames the selected hotspot server or default
-- profile records the old and new names before the mirror forgets the old one.
create function app.drift_on_rename() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_router public.routers;
begin
  if new.name is distinct from old.name then
    if tg_table_name = 'hotspot_servers' then
      select * into v_router from public.routers where hotspot_server_id = new.id;
      if found then
        perform app.record_drift(new.tenant_id, new.router_id, 'hotspot_server', new.mikrotik_id, 'name',
          to_jsonb(old.name), to_jsonb(new.name),
          format('The selected hotspot server was renamed on the router from "%s" to "%s".', old.name, new.name));
      end if;
    else
      select * into v_router from public.routers where default_hotspot_profile_id = new.id;
      if found then
        perform app.record_drift(new.tenant_id, new.router_id, 'hotspot_profile', new.mikrotik_id, 'name',
          to_jsonb(old.name), to_jsonb(new.name),
          format('The default hotspot profile was renamed on the router from "%s" to "%s".', old.name, new.name));
      end if;
    end if;
  end if;
  return null;
end;
$$;
create trigger hotspot_servers_drift_on_rename after update of name on public.hotspot_servers
  for each row execute function app.drift_on_rename();
create trigger hotspot_profiles_drift_on_rename after update of name on public.hotspot_profiles
  for each row execute function app.drift_on_rename();
revoke all on function app.drift_on_rename() from public;

-- -----------------------------------------------------------------------------
-- Credentials
-- -----------------------------------------------------------------------------
create function public.connector_take_submission(p_submission_id uuid)
returns table (router_id uuid, tenant_id uuid, sealed jsonb, superseded boolean)
language sql stable security definer set search_path = '' as $$
  select s.router_id, s.tenant_id, s.sealed,
         exists (select 1 from public.router_credential_submissions n
                  where n.router_id = s.router_id and n.created_at > s.created_at) as superseded
    from public.router_credential_submissions s
   where s.id = p_submission_id;
$$;

create function public.connector_store_credentials(
  p_submission_id uuid, p_username text, p_ciphertext text, p_key_version integer
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_sub public.router_credential_submissions;
begin
  select * into v_sub from public.router_credential_submissions where id = p_submission_id for update;
  if not found then
    raise exception 'submission % not found', p_submission_id using errcode = 'P0002';
  end if;
  insert into public.router_credentials (router_id, tenant_id, username, password_ciphertext, key_version, updated_at)
  values (v_sub.router_id, v_sub.tenant_id, p_username, p_ciphertext, p_key_version, now())
  on conflict (router_id) do update set username = excluded.username, password_ciphertext = excluded.password_ciphertext,
                                        key_version = excluded.key_version, updated_at = now();
  -- This submission and anything older are consumed.
  delete from public.router_credential_submissions
   where router_id = v_sub.router_id and created_at <= v_sub.created_at;
  update public.routers set credentials_status = 'set', credentials_updated_at = now(), consecutive_failures = 0
   where id = v_sub.router_id;
  perform app.write_audit(v_sub.tenant_id, 'router.credentials.stored', 'router', v_sub.router_id::text, null,
                          jsonb_build_object('key_version', p_key_version), null, 'connector');
end;
$$;

create function public.connector_reject_submission(p_submission_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_sub public.router_credential_submissions;
begin
  select * into v_sub from public.router_credential_submissions where id = p_submission_id for update;
  if not found then return; end if;
  delete from public.router_credential_submissions where id = p_submission_id;
  update public.routers
     set credentials_status = case when exists (select 1 from public.router_credentials c where c.router_id = v_sub.router_id)
                                   then 'set'::public.credentials_status else 'rejected'::public.credentials_status end
   where id = v_sub.router_id;
  perform app.write_audit(v_sub.tenant_id, 'router.credentials.rejected', 'router', v_sub.router_id::text, null,
                          jsonb_build_object('reason', left(p_reason, 200)), null, 'connector');
end;
$$;

create function public.connector_credentials_for_rekey(p_current_version integer, p_limit integer)
returns table (router_id uuid, username text, password_ciphertext text, key_version integer)
language sql stable security definer set search_path = '' as $$
  select c.router_id, c.username, c.password_ciphertext, c.key_version
    from public.router_credentials c
   where c.key_version <> p_current_version
   order by c.router_id
   limit greatest(1, least(coalesce(p_limit, 100), 1000));
$$;

create function public.connector_update_ciphertext(
  p_router_id uuid, p_ciphertext text, p_key_version integer, p_expected_version integer
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update public.router_credentials set password_ciphertext = p_ciphertext, key_version = p_key_version, updated_at = now()
   where router_id = p_router_id and key_version = p_expected_version;
  return found;
end;
$$;

-- -----------------------------------------------------------------------------
-- WireGuard
-- -----------------------------------------------------------------------------
create function public.connector_wg_peers()
returns table (router_id uuid, wg_public_key text, wg_address text)
language sql stable security definer set search_path = '' as $$
  select r.id, r.wg_public_key, r.wg_address from public.routers r
   where r.wg_public_key is not null and not r.is_demo
   order by r.wg_address;
$$;

-- p_handshakes: [{"public_key": "...", "at": "2026-09-11T10:00:00Z" | null}]
create function public.connector_record_handshakes(p_handshakes jsonb) returns integer
language sql security definer set search_path = '' as $$
  with h as (
    select x.public_key, x.at from jsonb_to_recordset(coalesce(p_handshakes, '[]'::jsonb)) as x(public_key text, at timestamptz)
  ), upd as (
    update public.routers r set wg_last_handshake_at = h.at
      from h
     where r.wg_public_key = h.public_key and r.wg_last_handshake_at is distinct from h.at
    returning 1)
  select count(*)::integer from upd;
$$;

-- -----------------------------------------------------------------------------
-- Retention
-- -----------------------------------------------------------------------------
create function public.connector_prune_metrics(p_default_retention_days integer) returns integer
language sql security definer set search_path = '' as $$
  with doomed as (
    delete from public.router_metrics m
     using public.routers r
     where r.id = m.router_id
       and m.captured_at < now() - make_interval(days => coalesce(
             (select (s.value #>> '{}')::integer from public.system_settings s
               where s.tenant_id = r.tenant_id and s.key = 'metrics_retention_days'),
             greatest(p_default_retention_days, 7)))
    returning 1)
  select count(*)::integer from doomed;
$$;

-- -----------------------------------------------------------------------------
-- Lock every connector function to the service role.
-- -----------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'connector\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end;
$$;
