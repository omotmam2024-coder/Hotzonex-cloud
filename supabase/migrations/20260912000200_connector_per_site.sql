-- =============================================================================
-- One connector per site.
--
-- Sites are separate networks: a connector on the Juba Market LAN can reach
-- 192.168.88.1 there and nothing at Gorom, and both routers may legitimately
-- carry the same address — every MikroTik ships as 192.168.88.1. So a router
-- now names the connector responsible for it, and a connector only takes work
-- it can actually carry out.
--
-- This also keeps credentials openable. Each connector derives its sealing key
-- pair from its own ENCRYPTION_KEY, so a password sealed to one connector
-- cannot be opened by another, and the ciphertext it stores is encrypted under
-- that key. Binding the router to a connector is what makes that consistent.
--
-- `connector_id is null` means "any connector", which is how every existing
-- router behaves: a single-connector install keeps working untouched.
-- =============================================================================

alter table public.routers
  add column connector_id text references public.connector_status (connector_id) on delete set null;

create index routers_connector_idx on public.routers (connector_id) where connector_id is not null;

grant insert (tenant_id, location_id, name, host, api_protocol, api_port, use_ssl, notes, connector_id)
  on public.routers to authenticated;
grant update (location_id, name, host, api_protocol, api_port, use_ssl, wg_public_key, hotspot_server_id,
              default_hotspot_profile_id, onboarding_completed_at, notes, connector_id)
  on public.routers to authenticated;

-- -----------------------------------------------------------------------------
-- Claim only jobs for routers this connector is responsible for.
-- -----------------------------------------------------------------------------
create or replace function public.connector_claim_jobs(p_connector_id text, p_limit integer, p_lease_seconds integer)
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
        -- A job without a router (maintenance) belongs to whichever connector asks.
        left join public.routers r on r.id = q.router_id
        where ((q.status = 'pending' and q.run_after <= now())
            or (q.status in ('claimed', 'running')
                and q.claimed_at < now() - make_interval(secs => greatest(p_lease_seconds, 30))))
          and (r.id is null or r.connector_id is null or r.connector_id = p_connector_id)
        order by q.run_after, q.created_at
        limit greatest(1, least(coalesce(p_limit, 10), 100))
        for update of q skip locked)
    returning j.*;
end;
$$;

-- -----------------------------------------------------------------------------
-- Poll only routers this connector can reach. A connector that does not name
-- itself gets every router, which is what a single-connector install wants and
-- what an older connector binary will keep doing.
-- -----------------------------------------------------------------------------
drop function public.connector_routers_due(integer, integer);

create function public.connector_routers_due(
  p_default_interval_seconds integer,
  p_limit integer,
  p_connector_id text default null
)
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
     where (r.credentials_status = 'set' or r.is_demo)
       and (p_connector_id is null or r.connector_id is null or r.connector_id = p_connector_id)
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

revoke all on function public.connector_routers_due(integer, integer, text) from public, anon, authenticated;
grant execute on function public.connector_routers_due(integer, integer, text) to service_role;
