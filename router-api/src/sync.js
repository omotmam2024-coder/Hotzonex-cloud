import { decrypt } from './crypto.js';
import { connectRouter, toRosTime, parseRosTime, RouterError } from './routeros.js';

const USERS = '/ip/hotspot/user';
const ACTIVE = '/ip/hotspot/active';
const PUSH_BATCH = 200;
const TAG = /^hzc:([0-9a-f-]{36})$/i;

const num = (v) => Number(v) || 0;

export function routerConfig(router, password) {
  return {
    host: router.host, port: router.port, conn: router.conn, tls: router.tls,
    username: router.username, password: password ?? decrypt(router.secret_ciphertext),
  };
}

async function markRouter(sb, id, patch) {
  await sb.from('routers').update(patch).eq('id', id);
}

/** Push unused/sold vouchers that are not yet on the router. Idempotent by username. */
async function pushPending(sb, client, router, site, existingNames) {
  const { data: pending, error } = await sb
    .from('vouchers')
    .select('id, code, password, plan:plans(uptime_seconds, bytes_limit, hotspot_profile)')
    .eq('site_id', router.site_id)
    .is('pushed_at', null)
    .in('status', ['unused', 'sold'])
    .order('created_at')
    .limit(PUSH_BATCH);
  if (error) throw error;

  const ok = [];
  for (const v of pending ?? []) {
    if (existingNames.has(v.code)) { ok.push(v.id); continue; }
    const user = {
      name: v.code,
      password: v.password,
      profile: v.plan.hotspot_profile,
      'limit-uptime': toRosTime(v.plan.uptime_seconds),
      comment: `hzc:${v.id}`,
    };
    if (v.plan.bytes_limit) user['limit-bytes-total'] = String(v.plan.bytes_limit);
    if (site.hotspot_server && site.hotspot_server !== 'all') user.server = site.hotspot_server;
    try {
      await client.add(USERS, user);
      ok.push(v.id);
    } catch (e) {
      await sb.from('vouchers').update({ push_error: e.message.slice(0, 500) }).eq('id', v.id);
      if (e instanceof RouterError && e.kind !== 'error') throw e; // connection lost: stop this cycle
    }
  }
  if (ok.length) {
    await sb.from('vouchers')
      .update({ pushed_at: new Date().toISOString(), push_error: null })
      .in('id', ok);
  }
  return ok.length;
}

/** Remove expired (after logout) and disabled (immediately) vouchers from the router. */
async function removeFinished(sb, client, router, userByName, activeRows) {
  const { data: done, error } = await sb
    .from('vouchers')
    .select('id, code, status')
    .eq('site_id', router.site_id)
    .in('status', ['expired', 'disabled'])
    .not('pushed_at', 'is', null)
    .is('removed_at', null)
    .limit(500);
  if (error) throw error;

  const activeByName = new Map();
  for (const a of activeRows) {
    if (!activeByName.has(a.user)) activeByName.set(a.user, []);
    activeByName.get(a.user).push(a);
  }

  const removed = [];
  for (const v of done ?? []) {
    const sessions = activeByName.get(v.code) ?? [];
    if (sessions.length && v.status === 'expired') continue; // never kick: wait for logout
    for (const s of sessions) await client.remove(ACTIVE, s['.id']); // disabled → kick now
    const u = userByName.get(v.code);
    if (u) await client.remove(USERS, u['.id']);
    removed.push(v.id);
  }
  if (removed.length) {
    await sb.from('vouchers').update({ removed_at: new Date().toISOString() }).in('id', removed);
  }
  return removed.length;
}

export async function syncRouter(sb, router) {
  let client;
  try {
    client = await connectRouter(routerConfig(router));
    const info = await client.identity();

    const { data: site, error: siteErr } = await sb
      .from('sites').select('hotspot_server').eq('id', router.site_id).single();
    if (siteErr) throw siteErr;

    let users = await client.print(USERS);
    const pushed = await pushPending(sb, client, router, site, new Set(users.map((u) => u.name)));
    if (pushed) users = await client.print(USERS);
    const active = await client.print(ACTIVE);

    // Live session counters may lead the user counters: take the max, never the sum.
    const activeUse = new Map();
    for (const a of active) {
      const prev = activeUse.get(a.user) ?? { up: 0, bytes: 0 };
      activeUse.set(a.user, {
        up: Math.max(prev.up, parseRosTime(a.uptime)),
        bytes: Math.max(prev.bytes, num(a['bytes-in']) + num(a['bytes-out'])),
      });
    }

    const usage = [];
    for (const u of users) {
      const m = TAG.exec(u.comment ?? '');
      if (!m) continue;
      const live = activeUse.get(u.name) ?? { up: 0, bytes: 0 };
      usage.push({
        voucher_id: m[1],
        uptime: Math.max(parseRosTime(u.uptime), live.up),
        bytes: Math.max(num(u['bytes-in']) + num(u['bytes-out']), live.bytes),
      });
    }

    const activeRows = active.map((a) => ({
      user: a.user, mac: a['mac-address'] ?? '', address: a.address ?? null,
      uptime: parseRosTime(a.uptime), bytes_in: num(a['bytes-in']), bytes_out: num(a['bytes-out']),
    }));

    const { data: expired, error: rpcErr } = await sb.rpc('apply_router_usage', {
      p_router_id: router.id, p_users: usage, p_active: activeRows,
    });
    if (rpcErr) throw rpcErr;

    const removed = await removeFinished(sb, client, router, new Map(users.map((u) => [u.name, u])), active);

    await markRouter(sb, router.id, {
      status: 'online', last_seen_at: new Date().toISOString(), last_error: null,
      routeros_version: info.version ?? router.routeros_version,
      board_name: info['board-name'] ?? router.board_name,
    });
    return { ok: true, pushed, removed, expired: expired ?? 0, active: active.length };
  } catch (e) {
    const status = e instanceof RouterError && e.kind === 'auth_failed' ? 'auth_failed'
                 : e instanceof RouterError && e.kind === 'offline' ? 'offline'
                 : router.status === 'unknown' ? 'offline' : router.status;
    await markRouter(sb, router.id, { status, last_error: String(e.message ?? e).slice(0, 500) });
    return { ok: false, error: String(e.message ?? e) };
  } finally {
    await client?.close();
  }
}

let running = false;
export async function syncAll(sb) {
  if (running) return;
  running = true;
  try {
    const { data: routers, error } = await sb.from('routers').select('*');
    if (error) throw error;
    // Sequential: a few routers per tenant, and it keeps the WireGuard link calm.
    for (const r of routers ?? []) {
      const result = await syncRouter(sb, r);
      if (!result.ok) console.warn(`[sync] ${r.name}: ${result.error}`);
    }
  } catch (e) {
    console.error('[sync] failed:', e.message ?? e);
  } finally {
    running = false;
  }
}
