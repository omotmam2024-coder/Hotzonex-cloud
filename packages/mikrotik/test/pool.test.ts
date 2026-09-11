import { describe, expect, it } from 'vitest';
import { computeBackoffMs } from '../src/backoff.js';
import { MOCK_FAILURE_PRESETS, MockMikrotikProvider, type MockBehavior } from '../src/mock/provider.js';
import { CircuitOpenError, RouterConnectionPool } from '../src/pool.js';
import type { ConnectionParams } from '../src/types.js';

const params: ConnectionParams = { host: '10.77.0.9', port: 8728, protocol: 'api', useSsl: false, username: 'hotzonex-api', password: 'p'.repeat(24), timeoutMs: 50 };

describe('computeBackoffMs', () => {
  it('doubles per attempt and caps', () => {
    const fixed = { baseMs: 1000, maxMs: 10_000, jitter: 0, random: () => 0.5 };
    expect([1, 2, 3, 4, 5, 6].map((n) => computeBackoffMs(n, fixed))).toEqual([1000, 2000, 4000, 8000, 10_000, 10_000]);
  });

  it('applies bounded jitter', () => {
    const low = computeBackoffMs(3, { baseMs: 1000, maxMs: 60_000, jitter: 0.2, random: () => 0 });
    const high = computeBackoffMs(3, { baseMs: 1000, maxMs: 60_000, jitter: 0.2, random: () => 0.999999 });
    expect(low).toBe(3200);
    expect(high).toBeGreaterThan(4700);
    expect(high).toBeLessThanOrEqual(4800);
  });
});

describe('RouterConnectionPool', () => {
  function setup(behavior: () => MockBehavior) {
    let now = 1_000_000;
    const created: MockMikrotikProvider[] = [];
    const pool = new RouterConnectionPool(
      (p) => {
        const m = new MockMikrotikProvider(p, { behavior });
        created.push(m);
        return m;
      },
      { now: () => now, random: () => 0.5, breaker: { failureThreshold: 3, baseCooldownMs: 60_000, maxCooldownMs: 600_000 } },
    );
    return { pool, created, advance: (ms: number) => (now += ms) };
  }

  it('reuses one session per router', async () => {
    const { pool, created } = setup(() => ({}));
    await pool.run('r1', params, (p) => p.getIdentity());
    await pool.run('r1', params, (p) => p.getInterfaces());
    expect(created).toHaveLength(1);
    await pool.closeAll();
  });

  it('opens the circuit after N consecutive failures and stops contacting the router', async () => {
    let behavior: MockBehavior = { connectFailure: MOCK_FAILURE_PRESETS.offline };
    const { pool, created, advance } = setup(() => behavior);
    for (let i = 0; i < 3; i++) {
      await expect(pool.run('r1', params, (p) => p.getIdentity())).rejects.toMatchObject({ code: 'UNREACHABLE' });
    }
    expect(pool.snapshot('r1')).toMatchObject({ status: 'open', consecutiveFailures: 3, lastErrorCode: 'UNREACHABLE' });
    const before = created.length;
    await expect(pool.run('r1', params, (p) => p.getIdentity())).rejects.toBeInstanceOf(CircuitOpenError);
    expect(created.length).toBe(before);

    // Cooldown elapses → half-open → one probe allowed; router is back → closed.
    advance(61_000);
    expect(pool.snapshot('r1').status).toBe('half_open');
    behavior = {};
    await pool.run('r1', params, (p) => p.getIdentity());
    expect(pool.snapshot('r1')).toMatchObject({ status: 'closed', consecutiveFailures: 0 });
    await pool.closeAll();
  });

  it('a failed half-open probe reopens with a longer cooldown', async () => {
    const { pool, advance } = setup(() => ({ connectFailure: MOCK_FAILURE_PRESETS.offline }));
    for (let i = 0; i < 3; i++) await pool.run('r1', params, (p) => p.getIdentity()).catch(() => undefined);
    expect(pool.snapshot('r1').openUntil).toBe(1_000_000 + 60_000);
    const probeAt = advance(61_000);
    await expect(pool.run('r1', params, (p) => p.getIdentity())).rejects.toMatchObject({ code: 'UNREACHABLE' });
    // Second opening doubles the cooldown (random fixed at 0.5 → no jitter).
    expect(pool.snapshot('r1')).toMatchObject({ status: 'open', openUntil: probeAt + 120_000 });
  });

  it('command-level errors (router answered) do not trip the breaker', async () => {
    const { pool, created } = setup(() => ({ methodFailures: { getSystemHealth: { kind: 'error', code: 'NOT_FOUND' } } }));
    for (let i = 0; i < 5; i++) await pool.run('r1', params, (p) => p.getSystemHealth()).catch(() => undefined);
    expect(pool.snapshot('r1').status).toBe('closed');
    expect(created).toHaveLength(1);
    await pool.closeAll();
  });

  it('enforces the hard timeout', async () => {
    const pool = new RouterConnectionPool((p) => new MockMikrotikProvider(p, { behavior: { connectFailure: { kind: 'timeout' } } }), {
      operationTimeoutMs: 20,
    });
    await expect(pool.run('r1', { ...params, timeoutMs: 5000 }, (p) => p.getIdentity())).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('drops the session when credentials change', async () => {
    const { pool, created } = setup(() => ({}));
    await pool.run('r1', params, (p) => p.getIdentity());
    await pool.run('r1', { ...params, password: 'n'.repeat(24) }, (p) => p.getIdentity());
    expect(created).toHaveLength(2);
    await pool.closeAll();
  });

  it('serialises operations per router', async () => {
    const { pool } = setup(() => ({}));
    const order: string[] = [];
    await Promise.all([
      pool.run('r1', params, async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push('a');
      }),
      pool.run('r1', params, async () => {
        order.push('b');
      }),
    ]);
    expect(order).toEqual(['a', 'b']);
    await pool.closeAll();
  });
});
