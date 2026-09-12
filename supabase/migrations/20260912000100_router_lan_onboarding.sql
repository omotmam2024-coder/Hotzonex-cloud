-- =============================================================================
-- Routers on the same network as the technician are added directly: type the
-- address, username and password, press Connect. No setup script, no tunnel.
--
-- Until now every router was reached at its tunnel address, so the browser had
-- no business setting one and `host` was left out of the column grants — the
-- insert trigger simply copied `wg_address` into it. Onboarding a router over
-- the LAN means naming the address the connector should dial, so operators may
-- now write `host` on insert and update.
--
-- The connector still does the dialling, which means it must be able to reach
-- that address: a connector on a VPS cannot see 192.168.88.1. Onboarding over
-- the LAN therefore assumes a connector on that LAN, and the tunnel flow stays
-- for routers behind CGNAT at a remote site.
-- =============================================================================

grant insert (tenant_id, location_id, name, host, api_protocol, api_port, use_ssl, notes)
  on public.routers to authenticated;
grant update (location_id, name, host, api_protocol, api_port, use_ssl, wg_public_key, hotspot_server_id,
              default_hotspot_profile_id, onboarding_completed_at, notes)
  on public.routers to authenticated;

-- The connector dials this address with stored credentials, and in REST mode
-- that makes it an HTTP client aimed wherever the row says. Routers live on a
-- private network — a LAN, or the tunnel — so that is all an operator may name.
-- This keeps the connector off its own loopback, off the link-local range that
-- cloud instances serve metadata from, and off the public internet.
alter table public.routers
  add constraint routers_host_is_private
  check (
    host like '10.%'
    or host like '192.168.%'
    or host ~ '^172\.(1[6-9]|2\d|3[01])\.'
  );

-- 10.77.0.0/16 is the tunnel pool. A router may be reached at its own tunnel
-- address, but must never be pointed at another router's.
alter table public.routers
  add constraint routers_host_not_another_tunnel
  check (host = wg_address or host not like '10.77.%');
