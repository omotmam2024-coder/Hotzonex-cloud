/**
 * UI-ONLY test double for Supabase (auth, PostgREST, RPC, Realtime socket),
 * installed with Playwright request interception. It lets the real web app be
 * rendered and screenshotted at 360px and desktop without a database.
 * It is NOT the end-to-end test — that one (e2e/) runs against a real stack.
 */
import type { Page, Route } from '@playwright/test';

export const MOCK_URL = 'https://mock-supabase.test';
const T = '00000000-0000-4000-8000-000000000001';
const USER_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

type Row = Record<string, unknown>;

function jwt(payload: Row): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.mock-signature`;
}

export function createFixtures() {
  const locations: Row[] = [
    { id: 'loc-1', tenant_id: T, name: 'Hotzonex Lologo One', address: 'Lologo, Juba', lat: 4.8231, lng: 31.5942, contact: 'Deng · +211 900 000 001', opening_hours: '07:00–22:00', status: 'active', created_at: iso(9e8), updated_at: iso(9e8) },
    { id: 'loc-2', tenant_id: T, name: 'Hotzonex Gorom', address: 'Gorom, Juba', lat: null, lng: null, contact: null, opening_hours: '07:00–22:00', status: 'maintenance', created_at: iso(9e8), updated_at: iso(9e8) },
    { id: 'loc-3', tenant_id: T, name: 'Hotzonex Juba', address: 'Juba town', lat: 4.8594, lng: 31.5713, contact: null, opening_hours: '08:00–20:00', status: 'active', created_at: iso(9e8), updated_at: iso(9e8) },
  ];
  const baseRouter = {
    tenant_id: T, api_protocol: 'api', api_port: 8728, use_ssl: false, status_reason: null, consecutive_failures: 0,
    credentials_status: 'set', credentials_updated_at: iso(8e8), hotspot_server_id: 'hs-1', default_hotspot_profile_id: 'hp-1',
    notes: null, created_by: USER_ID, created_at: iso(9e8), updated_at: iso(1e5), is_demo: false, onboarding_completed_at: iso(8e8),
    total_memory: 1073741824, free_memory: 690000000, architecture: 'arm64', last_polled_at: iso(90_000), discovered_at: iso(7e7),
  };
  const routers: Row[] = [
    { ...baseRouter, id: 'r-1', name: 'Lologo Gate', location_id: 'loc-1', host: '10.77.0.2', wg_address: '10.77.0.2', wg_public_key: 'kA8y4gUcJ8Tf8p0y5e1F2wdmS3O0Jx1xq6y9E2y3Z0I=', wg_last_handshake_at: iso(40_000), status: 'online', last_seen_at: iso(90_000), identity: 'HZX-LOLOGO-1', board_name: 'hAP ax^3', routeros_version: '7.19.4', uptime_seconds: 1_310_000, cpu_load: 7 },
    { ...baseRouter, id: 'r-2', name: 'Gorom Market', location_id: 'loc-2', host: '10.77.0.3', wg_address: '10.77.0.3', wg_public_key: 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=', wg_last_handshake_at: iso(5_400_000), status: 'offline', status_reason: 'UNREACHABLE: ehostunreach', last_seen_at: iso(5_400_000), identity: 'HZX-GOROM-1', board_name: 'RB5009UG+S+', routeros_version: '7.18.2', uptime_seconds: null, cpu_load: 12, consecutive_failures: 17 },
    { ...baseRouter, id: 'r-3', name: 'Juba Office', location_id: 'loc-3', host: '10.77.0.4', wg_address: '10.77.0.4', wg_public_key: 'aA8y4gUcJ8Tf8p0y5e1F2wdmS3O0Jx1xq6y9E2y3Z0I=', wg_last_handshake_at: iso(20_000), status: 'warning', status_reason: 'CPU at 91%', last_seen_at: iso(60_000), identity: 'HZX-JUBA-1', board_name: 'hEX S', architecture: 'mmips', routeros_version: '7.19.4', uptime_seconds: 86_400 * 3, cpu_load: 91 },
    { ...baseRouter, id: 'r-4', name: 'Munuki Kiosk', location_id: null, host: '10.77.0.5', wg_address: '10.77.0.5', wg_public_key: null, wg_last_handshake_at: null, status: 'unknown', last_seen_at: null, identity: null, board_name: null, architecture: null, routeros_version: null, uptime_seconds: null, cpu_load: null, credentials_status: 'pending', onboarding_completed_at: null, discovered_at: null, hotspot_server_id: null, default_hotspot_profile_id: null, total_memory: null, free_memory: null, last_polled_at: null },
    { ...baseRouter, id: 'd-1', name: 'Lologo Gate (demo)', location_id: 'loc-1', host: '10.77.0.6', wg_address: '10.77.0.6', wg_public_key: null, wg_last_handshake_at: null, status: 'online', last_seen_at: iso(30_000), identity: 'HZX-DEMO', board_name: 'hAP ax^3', routeros_version: '7.19.4', uptime_seconds: 500_000, cpu_load: 18, is_demo: true, credentials_status: 'not_set' },
  ];
  const buckets: Row[] = [];
  const bucketMs = 6 * 3_600_000;
  const last = Math.floor(now / bucketMs) * bucketMs;
  for (const r of routers) {
    if (!r['last_seen_at']) continue;
    for (let i = 0; i < 28; i++) {
      const start = last - (27 - i) * bucketMs;
      let reach = 72;
      if (r['id'] === 'r-2') reach = i > 25 ? 0 : i % 7 === 3 ? 40 : 72;
      if (r['id'] === 'r-3' && i === 10) reach = 60;
      if (r['id'] === 'r-1' && (i === 4 || i === 5)) continue; // a gap: connector was down
      buckets.push({ router_id: r['id'], bucket_start: new Date(start).toISOString(), samples: 72, reachable_samples: reach });
    }
  }
  const tenant = { id: T, name: 'Hotzonex WiFi/IT Solutions', slug: 'hotzonex', currency_default: 'SSP', created_at: iso(9e8), updated_at: iso(9e8) };
  const profile = { id: USER_ID, tenant_id: T, email: 'admin@hotzonex.com', full_name: 'Hotzonex Administrator', role: 'SUPER_ADMIN', status: 'active', created_at: iso(9e8), updated_at: iso(9e8) };
  const connector = {
    connector_id: 'vps-juba-1', version: '0.1.0', provider_mode: 'api', sealing_key_id: '4562646582d757ceac853733973ac637',
    sealing_public_key: { kty: 'EC', crv: 'P-256', x: 'thjhJDi35zjuZNo2N_5wO8c94vO94gr6yiPcPvP_Dyk', y: '5wGiHsYPuJEp4BeQaTx8Dsso7Nvyo_KtXAclXflHBEs' },
    wg_server_public_key: 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=', wg_endpoint: 'wg.hotzonex.com:51820', wg_server_address: '10.77.0.1',
    started_at: iso(3_600_000 * 30), last_heartbeat_at: iso(10_000),
  };
  const audit: Row[] = [
    { id: 5, tenant_id: T, actor_id: USER_ID, actor_email: 'admin@hotzonex.com', actor_type: 'user', action: 'router.test_connection.requested', entity_type: 'router', entity_id: 'r-1', before: null, after: { job_id: 'j-1' }, ip: '41.79.20.5', user_agent: 'Mozilla/5.0', created_at: iso(120_000) },
    { id: 4, tenant_id: T, actor_id: null, actor_email: 'connector', actor_type: 'connector', action: 'router.credentials.stored', entity_type: 'router', entity_id: 'r-1', before: null, after: { key_version: 1 }, ip: null, user_agent: null, created_at: iso(300_000) },
    { id: 3, tenant_id: T, actor_id: USER_ID, actor_email: 'admin@hotzonex.com', actor_type: 'user', action: 'location.updated', entity_type: 'location', entity_id: 'loc-1', before: { lat: null, lng: null }, after: { lat: 4.8231, lng: 31.5942 }, ip: '41.79.20.5', user_agent: 'Mozilla/5.0', created_at: iso(900_000) },
    { id: 2, tenant_id: T, actor_id: USER_ID, actor_email: 'admin@hotzonex.com', actor_type: 'user', action: 'auth.login', entity_type: 'user', entity_id: USER_ID, before: null, after: { session_id: 's' }, ip: '41.79.20.5', user_agent: 'Mozilla/5.0', created_at: iso(1_000_000) },
  ];
  const interfaces: Row[] = [
    { id: 'i-1', tenant_id: T, router_id: 'r-1', mikrotik_id: '*1', name: 'ether1', type: 'ether', mac: '48:A9:8A:10:22:31', running: true, disabled: false, rx_bytes: 912_000_000_000, tx_bytes: 120_000_000_000, mtu: 1500, comment: 'Starlink WAN', synced_at: iso(7e7), removed_at: null },
    { id: 'i-2', tenant_id: T, router_id: 'r-1', mikrotik_id: '*5', name: 'bridge-hotspot', type: 'bridge', mac: '48:A9:8A:10:22:35', running: true, disabled: false, rx_bytes: 510_000_000_000, tx_bytes: 990_000_000_000, mtu: 1500, comment: null, synced_at: iso(7e7), removed_at: null },
    { id: 'i-3', tenant_id: T, router_id: 'r-1', mikrotik_id: '*6', name: 'hotzonex-wg', type: 'wg', mac: null, running: true, disabled: false, rx_bytes: 48_000_000, tx_bytes: 51_000_000, mtu: 1420, comment: 'Hotzonex Cloud tunnel', synced_at: iso(7e7), removed_at: null },
  ];
  const servers: Row[] = [
    { id: 'hs-1', tenant_id: T, router_id: 'r-1', mikrotik_id: '*1', name: 'hotspot1', interface: 'bridge-hotspot', address_pool: 'hs-pool-1', profile: 'hsprof1', disabled: false, invalid: false, first_seen_at: iso(8e8), synced_at: iso(7e7), removed_at: null },
  ];
  const hprofiles: Row[] = [
    { id: 'hp-1', tenant_id: T, router_id: 'r-1', mikrotik_id: '*0', name: 'default', rate_limit: null, shared_users: 1, session_timeout_seconds: null, idle_timeout_seconds: null, keepalive_timeout_seconds: 120, address_pool: null, is_default: true, first_seen_at: iso(8e8), synced_at: iso(7e7), removed_at: null },
    { id: 'hp-2', tenant_id: T, router_id: 'r-1', mikrotik_id: '*1', name: '1hr-512k', rate_limit: '512k/512k', shared_users: 1, session_timeout_seconds: 3600, idle_timeout_seconds: 300, keepalive_timeout_seconds: 120, address_pool: null, is_default: false, first_seen_at: iso(8e8), synced_at: iso(7e7), removed_at: null },
  ];
  const drift: Row[] = [
    { id: 'dr-1', tenant_id: T, router_id: 'r-1', entity_type: 'hotspot_profile', mikrotik_id: '*3', field: 'name', expected: 'week-5M', actual: 'week-5M-old', message: 'The default hotspot profile was renamed on the router from "week-5M" to "week-5M-old".', detected_at: iso(4e6), resolved_at: null, resolved_by: null },
  ];
  const metrics: Row[] = [
    { id: 1, tenant_id: T, router_id: 'r-1', captured_at: iso(90_000), reachable: true, latency_ms: 612, cpu_load: 7, free_memory: 690000000, total_memory: 1073741824, uptime_seconds: 1_310_000, health: { sensors: [{ name: 'cpu-temperature', value: 48, unit: 'C', state: null }, { name: 'psu1-state', value: null, unit: null, state: 'ok' }] }, error_code: null },
  ];
  const jobs: Row[] = [];
  return { tenant, profile, locations, routers, buckets, connector, audit, interfaces, servers, hprofiles, drift, metrics, jobs };
}

function filterRows(rows: Row[], url: URL): Row[] {
  let out = rows;
  for (const [key, value] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset', 'or'].includes(key)) continue;
    const m = /^(eq|is|ilike|gte|lte)\.(.*)$/.exec(value);
    if (!m) continue;
    const [, op, v] = m;
    if (op === 'eq') out = out.filter((r) => String(r[key]) === v);
    if (op === 'is' && v === 'null') out = out.filter((r) => r[key] === null || r[key] === undefined);
  }
  const limit = url.searchParams.get('limit');
  return limit ? out.slice(0, Number(limit)) : out;
}

export async function installMockBackend(page: Page, fx = createFixtures()): Promise<typeof fx> {
  const session = {
    access_token: jwt({ sub: USER_ID, role: 'authenticated', aud: 'authenticated', exp: Math.floor(now / 1000) + 3600, email: 'admin@hotzonex.com' }),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(now / 1000) + 3600,
    refresh_token: 'mock-refresh',
    user: { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'admin@hotzonex.com', app_metadata: {}, user_metadata: {}, created_at: iso(9e8) },
  };

  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

  await page.routeWebSocket(/mock-supabase\.test\/realtime/, () => {
    // Accept and stay silent: no live updates in the UI-only suite.
  });

  await page.route(`${MOCK_URL}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    }
    if (path === '/auth/v1/token') {
      const body = req.postDataJSON() as { password?: string } | null;
      if (url.searchParams.get('grant_type') === 'password' && body?.password !== 'CorrectPassword1') {
        return json(route, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
      }
      return json(route, session);
    }
    if (path === '/auth/v1/user') return json(route, session.user);
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204 });

    const rpc = /^\/rest\/v1\/rpc\/(.+)$/.exec(path);
    if (rpc) {
      const fn = rpc[1];
      const args = (req.postDataJSON() ?? {}) as Row;
      if (fn === 'router_uptime_buckets') return json(route, fx.buckets);
      if (fn === 'enqueue_router_job') {
        const r = fx.routers.find((x) => x['id'] === args['p_router_id']) ?? fx.routers[0]!;
        const result =
          args['p_type'] === 'router.test_connection'
            ? { latencyMs: 640, identity: r['identity'] ?? 'HZX-NEW', routerOsVersion: '7.19.4', boardName: 'hAP ax^3', architecture: 'arm64', cpuLoad: 9, freeMemory: 690000000, totalMemory: 1073741824, uptimeSeconds: 1310000 }
            : args['p_type'] === 'router.sync'
              ? { identity: 'HZX-NEW', routerOsVersion: '7.19.4', boardName: 'hAP ax^3', architecture: 'arm64', interfaces: { added: 6, updated: 0, removed: 0, unchanged: 0 }, hotspot_servers: { added: 1, updated: 0, removed: 0, unchanged: 0 }, hotspot_profiles: { added: 4, updated: 0, removed: 0, unchanged: 0 }, drift_recorded: 0 }
              : { entries: [] };
        const job = { id: `j-${fx.jobs.length + 1}`, tenant_id: T, router_id: args['p_router_id'], type: args['p_type'], payload: {}, status: 'succeeded', attempts: 1, max_attempts: 1, deferrals: 0, idempotency_key: args['p_idempotency_key'], result, last_error: null, last_error_code: null, claimed_by: 'vps-juba-1', claimed_at: iso(0), run_after: iso(0), expires_at: iso(-6e8), started_at: iso(0), finished_at: iso(0), created_by: USER_ID, created_at: iso(0), updated_at: iso(0) };
        fx.jobs.unshift(job);
        return json(route, job);
      }
      if (fn === 'submit_router_credentials') {
        const job = { id: `j-${fx.jobs.length + 1}`, tenant_id: T, router_id: args['p_router_id'], type: 'router.ingest_credentials', payload: {}, status: 'succeeded', attempts: 1, max_attempts: 3, deferrals: 0, idempotency_key: 'k', result: { stored: true, superseded: false, keyVersion: 1 }, last_error: null, last_error_code: null, claimed_by: 'vps', claimed_at: iso(0), run_after: iso(0), expires_at: iso(-6e8), started_at: iso(0), finished_at: iso(0), created_by: USER_ID, created_at: iso(0), updated_at: iso(0) };
        fx.jobs.unshift(job);
        return json(route, job);
      }
      return json(route, null);
    }

    const table = /^\/rest\/v1\/(.+)$/.exec(path)?.[1];
    const wantsObject = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
    const reply = (rows: Row[]) => (wantsObject ? (rows[0] ? json(route, rows[0]) : json(route, { code: 'PGRST116', message: 'no rows' }, 406)) : json(route, rows));
    switch (table) {
      case 'profiles': {
        const select = url.searchParams.get('select') ?? '';
        const rows = select.includes('tenant') ? [{ ...fx.profile, tenant: fx.tenant }] : [fx.profile];
        return reply(filterRows(rows, url));
      }
      case 'routers':
        return reply(filterRows(fx.routers.map((r) => ({ ...r, location: fx.locations.find((l) => l['id'] === r['location_id']) ?? null })), url));
      case 'locations':
        return reply(fx.locations.map((l) => ({ ...l, routers: fx.routers.filter((r) => r['location_id'] === l['id']).map((r) => ({ id: r['id'], name: r['name'], status: r['status'], is_demo: r['is_demo'] })) })));
      case 'connector_status':
        return reply([fx.connector]);
      case 'system_settings':
        return reply([]);
      case 'audit_logs':
        return reply(filterRows(fx.audit, url));
      case 'router_interfaces':
        return reply(filterRows(fx.interfaces, url));
      case 'hotspot_servers':
        return reply(filterRows(fx.servers, url));
      case 'hotspot_profiles':
        return reply(filterRows(fx.hprofiles, url));
      case 'sync_drift':
        return reply(filterRows(fx.drift, url));
      case 'router_metrics':
        return reply(filterRows(fx.metrics, url));
      case 'jobs':
        return reply(filterRows(fx.jobs, url));
      case 'invites':
        return reply([]);
      default:
        return json(route, []);
    }
  });
  return fx;
}
