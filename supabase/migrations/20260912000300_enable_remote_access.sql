-- =============================================================================
-- Turning a local router into a remotely reachable one.
--
-- A router added on the local network is already reachable with a login that
-- works, so the connector can configure the WireGuard tunnel over that same
-- connection — nobody pastes a script. The router generates its own private key
-- and reports only the public half, exactly as the script flow does.
--
-- The tunnel address is not created here: every router is allocated one from
-- the pool the moment it is inserted (app.allocate_wg_address). Enabling remote
-- access is what starts using it.
-- =============================================================================

insert into public.job_types (type, description, destructive, defer_when_offline, max_attempts, user_enqueueable) values
  ('router.enable_remote',
   'Configure the WireGuard tunnel on a reachable router so it can be managed remotely. Idempotent.',
   false, false, 3, true);

-- -----------------------------------------------------------------------------
-- Records the outcome: the router's public key, the switch to its tunnel
-- address, and the hand-over to the connector that serves the tunnel.
--
-- Service role only — the connector calls this after the router confirmed the
-- configuration. Browsers can already write `wg_public_key`, but not `host`
-- into the tunnel range, so this is the only path that completes the move.
-- -----------------------------------------------------------------------------
create function public.connector_enable_remote(p_router_id uuid, p_public_key text)
returns public.routers
language plpgsql security definer set search_path = '' as $$
declare
  v_router public.routers;
  v_tunnel_connector text;
begin
  select * into v_router from public.routers where id = p_router_id for update;
  if not found then
    raise exception 'Router not found.' using errcode = 'P0002', hint = 'not_found';
  end if;
  if p_public_key !~ '^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$' then
    raise exception 'That is not a WireGuard public key.' using errcode = '22023', hint = 'invalid_wg_key';
  end if;

  -- Whoever publishes a tunnel endpoint serves the tunnel. With none, the
  -- router keeps its current connector and simply gains a tunnel address.
  select cs.connector_id into v_tunnel_connector
    from public.connector_status cs
   where cs.wg_endpoint is not null and cs.wg_server_public_key is not null
   order by cs.last_heartbeat_at desc
   limit 1;

  update public.routers
     set wg_public_key = p_public_key,
         host = wg_address,
         connector_id = coalesce(v_tunnel_connector, connector_id)
   where id = p_router_id
  returning * into v_router;

  perform app.write_audit(v_router.tenant_id, 'router.remote_enabled', 'router', p_router_id::text, null,
                          jsonb_build_object('host', v_router.host, 'connector_id', v_router.connector_id));
  return v_router;
end;
$$;

revoke all on function public.connector_enable_remote(uuid, text) from public, anon, authenticated;
grant execute on function public.connector_enable_remote(uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- Which connector the router should dial. The site connector doing the work is
-- usually not the tunnel server: it sits on the LAN and has no endpoint of its
-- own, so the peer details come from whichever connector publishes one.
-- -----------------------------------------------------------------------------
create function public.connector_tunnel_server()
returns table (connector_id text, wg_server_public_key text, wg_endpoint text, wg_server_address text)
language sql stable security definer set search_path = '' as $$
  select cs.connector_id, cs.wg_server_public_key, cs.wg_endpoint, cs.wg_server_address
    from public.connector_status cs
   where cs.wg_endpoint is not null
     and cs.wg_server_public_key is not null
     and cs.wg_server_address is not null
   order by cs.last_heartbeat_at desc
   limit 1;
$$;

revoke all on function public.connector_tunnel_server() from public, anon, authenticated;
grant execute on function public.connector_tunnel_server() to service_role;

-- The tunnel address the router is about to claim was allocated when the router
-- was created; the connector needs to see it to build the configuration.
drop function public.connector_get_router(uuid);

create function public.connector_get_router(p_router_id uuid)
returns table (
  id uuid, tenant_id uuid, name text, host text, api_protocol public.api_protocol, api_port integer,
  use_ssl boolean, is_demo boolean, status public.router_status, consecutive_failures integer,
  credentials_status public.credentials_status, wg_public_key text, wg_address text, wg_last_handshake_at timestamptz,
  hotspot_server_id uuid, default_hotspot_profile_id uuid,
  username text, password_ciphertext text, key_version integer
)
language sql stable security definer set search_path = '' as $$
  select r.id, r.tenant_id, r.name, r.host, r.api_protocol, r.api_port, r.use_ssl, r.is_demo, r.status,
         r.consecutive_failures, r.credentials_status, r.wg_public_key, r.wg_address, r.wg_last_handshake_at,
         r.hotspot_server_id, r.default_hotspot_profile_id, c.username, c.password_ciphertext, c.key_version
    from public.routers r
    left join public.router_credentials c on c.router_id = r.id
   where r.id = p_router_id;
$$;

revoke all on function public.connector_get_router(uuid) from public, anon, authenticated;
grant execute on function public.connector_get_router(uuid) to service_role;
