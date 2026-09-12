import { describe, expect, it } from 'vitest';
import { buildUptimeSeries } from '@/components/uptime-bars';
import { sortRoutersForOps } from '@/components/router-table';
import { toAppError } from '@/lib/errors';
import { readEnv } from '@/lib/env';
import { describeConnector } from '@/lib/queries/misc';
import { PERSISTED_QUERY_ROOTS, shouldPersist } from '@/lib/query-client';
import { previousStep, resumeStep, routerMode, stepsFor } from '@/lib/wizard';
import { countRouters } from '@/pages/dashboard';

describe('dashboard counts', () => {
  it('never counts a DEMO router as a real or online router', () => {
    const counts = countRouters([
      { status: 'online', is_demo: true },
      { status: 'online', is_demo: true },
      { status: 'online', is_demo: false },
      { status: 'offline', is_demo: false },
      { status: 'warning', is_demo: false },
      { status: 'unknown', is_demo: false },
    ]);
    expect(counts).toEqual({ total: 4, online: 1, offline: 1, attention: 1, unknown: 1, demo: 2 });
  });

  it('puts problems first and demos last', () => {
    const base = { location: null };
    const sorted = sortRoutersForOps([
      { ...base, name: 'b', status: 'online', is_demo: false },
      { ...base, name: 'demo', status: 'offline', is_demo: true },
      { ...base, name: 'a', status: 'offline', is_demo: false },
      { ...base, name: 'c', status: 'warning', is_demo: false },
    ] as never);
    expect(sorted.map((r) => r.name)).toEqual(['a', 'c', 'b', 'demo']);
  });
});

describe('uptime series', () => {
  it('lays buckets on a fixed 7-day grid with gaps for missing windows', () => {
    const now = new Date('2026-09-11T13:00:00Z');
    const series = buildUptimeSeries(
      [
        { router_id: 'r1', bucket_start: '2026-09-11T12:00:00Z', samples: 12, reachable_samples: 12 },
        { router_id: 'r1', bucket_start: '2026-09-11T06:00:00Z', samples: 12, reachable_samples: 6 },
        { router_id: 'r2', bucket_start: '2026-09-11T12:00:00Z', samples: 12, reachable_samples: 0 },
        { router_id: 'r1', bucket_start: '2026-08-01T00:00:00Z', samples: 12, reachable_samples: 0 },
      ],
      'r1',
      now,
    );
    expect(series.slots).toHaveLength(28);
    expect(series.slots[27]).toMatchObject({ samples: 12, reachable: 12 });
    expect(series.slots[26]).toMatchObject({ samples: 12, reachable: 6 });
    expect(series.slots.filter(Boolean)).toHaveLength(2);
    expect(series.ratio).toBe(0.75);
  });

  it('reports no ratio rather than 0% when there is no data', () => {
    expect(buildUptimeSeries([], 'r1', new Date()).ratio).toBeNull();
  });
});

describe('wizard resume', () => {
  // A tunnel router is reached at its own tunnel address; anything else was
  // added by address on the local network.
  const tunnel = {
    credentials_status: 'set',
    host: '10.77.0.5',
    wg_address: '10.77.0.5',
    wg_public_key: 'k',
    is_demo: false,
    last_seen_at: 'x',
    discovered_at: 'x',
    hotspot_server_id: 'h',
    onboarding_completed_at: null,
    location_id: 'l',
  } as const;
  const lan = { ...tunnel, host: '192.168.88.1' } as const;

  it.each([
    [{}, 'finish'],
    // No credentials, or no tunnel key, both send the technician back to the
    // script: it is the script that sets the password and prints the key.
    [{ credentials_status: 'not_set' }, 'script'],
    [{ credentials_status: 'rejected' }, 'script'],
    [{ wg_public_key: null }, 'script'],
    [{ last_seen_at: null }, 'test'],
    [{ discovered_at: null }, 'discover'],
    [{ hotspot_server_id: null }, 'hotspot'],
    [{ location_id: null }, 'location'],
  ])('tunnel %j → %s', (patch, step) => {
    expect(resumeStep({ ...tunnel, ...patch } as never)).toBe(step);
  });

  it.each([
    [{}, 'finish'],
    // A local router has no script and no tunnel key to wait for: the only
    // thing that can be missing is a login that works.
    [{ credentials_status: 'not_set' }, 'connect'],
    [{ credentials_status: 'rejected' }, 'connect'],
    [{ wg_public_key: null }, 'finish'],
    [{ last_seen_at: null }, 'test'],
    [{ discovered_at: null }, 'discover'],
  ])('lan %j → %s', (patch, step) => {
    expect(resumeStep({ ...lan, ...patch } as never)).toBe(step);
  });

  it('starts a new router on the local-network path', () => expect(resumeStep(null)).toBe('connect'));

  it('offers remote access to a fresh local router, and stops offering once answered', () => {
    const fresh = { ...lan, discovered_at: null, wg_public_key: null } as const;
    expect(resumeStep(fresh as never)).toBe('remote');
    // Said yes: the router has a tunnel key now, so it moves on.
    expect(resumeStep({ ...fresh, wg_public_key: 'k' } as never)).toBe('discover');
    // Said no and carried on: discovery done means the question is behind it.
    expect(resumeStep({ ...fresh, discovered_at: 'x', hotspot_server_id: null } as never)).toBe('hotspot');
    // A router that came through the script is already remote; it is never asked.
    expect(resumeStep({ ...tunnel, discovered_at: null } as never)).toBe('discover');
  });

  it('tells the two paths apart by address', () => {
    expect(routerMode(tunnel)).toBe('tunnel');
    expect(routerMode(lan)).toBe('lan');
  });

  it('never resumes into a step that only explains the hardware', () => {
    const explainOnly = ['prepare', 'credentials', 'key'];
    for (const base of [tunnel, lan]) {
      for (const patch of [{}, { credentials_status: 'not_set' }, { wg_public_key: null }, { last_seen_at: null }, { location_id: null }]) {
        expect(explainOnly).not.toContain(resumeStep({ ...base, ...patch } as never));
      }
    }
  });

  it('offers only the steps that belong to each path', () => {
    // Remote access is offered only to a router added locally; one that came
    // through the script is already on the tunnel.
    expect(stepsFor('lan')).toEqual(['connect', 'test', 'remote', 'discover', 'hotspot', 'location', 'finish']);
    expect(stepsFor('tunnel')).toEqual(['details', 'prepare', 'credentials', 'script', 'key', 'test', 'discover', 'hotspot', 'location', 'finish']);
  });

  it('steps back one screen, and leaves the wizard from the first', () => {
    expect(previousStep('prepare', 'tunnel')).toBe('details');
    expect(previousStep('key', 'tunnel')).toBe('script');
    expect(previousStep('details', 'tunnel')).toBeNull();
    expect(previousStep('test', 'lan')).toBe('connect');
    expect(previousStep('connect', 'lan')).toBeNull();
  });
});

describe('user-facing errors', () => {
  it('maps database hints and auth errors to sentences, never raw text', () => {
    expect(toAppError({ message: 'x', hint: 'rate_limited' }).userMessage).toMatch(/Too many requests/);
    expect(toAppError({ message: 'Invalid login credentials', status: 400 }).userMessage).toBe('Email or password is incorrect.');
    expect(toAppError({ message: 'TypeError: Failed to fetch' }).kind).toBe('network');
    expect(toAppError({ code: '42501', message: 'permission denied for table router_credentials' }).userMessage).not.toMatch(/router_credentials/);
    const unknown = toAppError(new Error('relation "public.secret" does not exist at character 15'));
    expect(unknown.userMessage).not.toMatch(/relation|character|secret/);
  });

  it('says so when the app is ahead of its database, instead of blaming the server', () => {
    // A deployed build calling a column or function a pending migration adds.
    for (const code of ['PGRST204', 'PGRST202', '42703', '42883', '42P01']) {
      const e = toAppError({ code, message: "Could not find the 'connector_id' column of 'routers' in the schema cache" });
      expect(e.userMessage, code).toMatch(/pending update has not been applied/i);
      expect(e.userMessage, code).not.toMatch(/connector_id|schema cache/);
    }
    // An error with no such cause still gets the neutral message.
    expect(toAppError(new Error('boom')).userMessage).toMatch(/went wrong on our side/i);
  });
});

describe('offline cache', () => {
  it('persists only network-state queries — never credentials, jobs or audit', () => {
    const q = (key: unknown[], status = 'success') => ({ queryKey: key, state: { status } }) as never;
    expect(shouldPersist(q(['routers']))).toBe(true);
    expect(shouldPersist(q(['router', 'abc']))).toBe(true);
    expect(shouldPersist(q(['jobs', 'one', 'x']))).toBe(false);
    expect(shouldPersist(q(['audit', {}]))).toBe(false);
    expect(shouldPersist(q(['team']))).toBe(false);
    expect(shouldPersist(q(['routers'], 'error'))).toBe(false);
    expect(PERSISTED_QUERY_ROOTS.some((k) => /cred|password|secret/i.test(k))).toBe(false);
  });
});

describe('configuration', () => {
  it('reports missing variables by name', () => {
    expect(readEnv({})).toEqual({ ok: false, missing: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] });
    expect(readEnv({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: 'x'.repeat(40) }).ok).toBe(true);
  });
});

describe('connector view', () => {
  it('parses the published sealing key and WireGuard endpoint, and detects staleness', () => {
    const row = {
      connector_id: 'vps-1',
      version: '0.1.0',
      provider_mode: 'api',
      sealing_key_id: 'abcdef0123456789',
      sealing_public_key: { kty: 'EC', crv: 'P-256', x: 'X', y: 'Y' },
      wg_server_public_key: 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=',
      wg_endpoint: 'wg.hotzonex.com:51820',
      wg_server_address: '10.77.0.1',
      started_at: '2026-09-11T10:00:00Z',
      last_heartbeat_at: '2026-09-11T12:00:00Z',
    };
    const fresh = describeConnector(row as never, Date.parse('2026-09-11T12:00:30Z'));
    expect(fresh).toMatchObject({ online: true, mock: false, wg: { endpointHost: 'wg.hotzonex.com', endpointPort: 51820 } });
    expect(fresh.sealingKey).toEqual({ kid: 'abcdef0123456789', jwk: { kty: 'EC', crv: 'P-256', x: 'X', y: 'Y' } });
    expect(describeConnector(row as never, Date.parse('2026-09-11T12:05:00Z')).online).toBe(false);
    expect(describeConnector(null).sealingKey).toBeNull();
  });
});
