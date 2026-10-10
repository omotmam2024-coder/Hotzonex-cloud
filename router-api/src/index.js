import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { encrypt } from './crypto.js';
import { connectRouter, defaultPort } from './routeros.js';
import { routerConfig, syncRouter, syncAll } from './sync.js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PUBLIC_COLS =
  'id,tenant_id,site_id,name,host,port,conn,tls,username,routeros_version,board_name,status,last_seen_at,last_error,created_at';

const app = express();
app.use(cors({ origin: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean) }));
app.use(express.json({ limit: '100kb' }));

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

async function requireUser(req, res, next) {
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'missing token' });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'invalid session' });
  req.user = data.user;
  next();
}

async function isAdmin(tenantId, userId) {
  const { data } = await sb.from('memberships').select('role')
    .eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle();
  return !!data && ['owner', 'admin'].includes(data.role);
}

/** Load a router (with secret) only if the caller is owner/admin of its tenant. */
async function adminRouter(req, res) {
  const { data: router } = await sb.from('routers').select('*').eq('id', req.params.id).maybeSingle();
  if (!router || !(await isAdmin(router.tenant_id, req.user.id))) {
    res.status(404).json({ error: 'router not found' });
    return null;
  }
  return router;
}

async function probe(cfg) {
  const client = await connectRouter(cfg);
  try { return await client.identity(); } finally { await client.close(); }
}

const connFields = {
  host: z.string().trim().min(1).max(253).regex(/^[A-Za-z0-9.\-:]+$/, 'host must be an IP or hostname'),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  conn: z.enum(['rest', 'api']).default('rest'),
  tls: z.boolean().default(false),
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
};
const createSchema = z.object({
  tenant_id: z.string().uuid(),
  site_id: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  ...connFields,
});
const updateSchema = z.object(connFields);

app.get('/health', (_req, res) => res.json({ ok: true }));

// Add a MikroTik router: probe first, store nothing on failure.
app.post('/routers', requireUser, wrap(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const b = parsed.data;
  if (!(await isAdmin(b.tenant_id, req.user.id))) return res.status(403).json({ error: 'owners/admins only' });

  const { data: site } = await sb.from('sites').select('id')
    .eq('id', b.site_id).eq('tenant_id', b.tenant_id).maybeSingle();
  if (!site) return res.status(400).json({ error: 'site not found in this tenant' });

  const port = b.port ?? defaultPort(b.conn, b.tls);
  let info;
  try {
    info = await probe({ ...b, port });
  } catch (e) {
    return res.status(422).json({ error: `Could not connect: ${e.message}`, kind: e.kind ?? 'error' });
  }

  const { data, error } = await sb.from('routers').insert({
    tenant_id: b.tenant_id, site_id: b.site_id, name: b.name,
    host: b.host, port, conn: b.conn, tls: b.tls, username: b.username,
    secret_ciphertext: encrypt(b.password),
    routeros_version: info.version ?? null, board_name: info['board-name'] ?? null,
    status: 'online', last_seen_at: new Date().toISOString(),
  }).select(PUBLIC_COLS).single();

  if (error?.code === '23505') return res.status(409).json({ error: 'this site already has a router' });
  if (error) throw error;
  res.status(201).json(data);
}));

app.post('/routers/:id/test', requireUser, wrap(async (req, res) => {
  const router = await adminRouter(req, res);
  if (!router) return;
  try {
    const info = await probe(routerConfig(router));
    await sb.from('routers').update({
      status: 'online', last_seen_at: new Date().toISOString(), last_error: null,
      routeros_version: info.version ?? null, board_name: info['board-name'] ?? null,
    }).eq('id', router.id);
    res.json({ ok: true, version: info.version, board: info['board-name'], uptime: info.uptime });
  } catch (e) {
    const status = e.kind === 'auth_failed' ? 'auth_failed' : 'offline';
    await sb.from('routers').update({ status, last_error: e.message }).eq('id', router.id);
    res.status(422).json({ ok: false, error: e.message, kind: e.kind ?? 'error' });
  }
}));

// Change address/credentials: probe the new settings before saving.
app.put('/routers/:id/connection', requireUser, wrap(async (req, res) => {
  const router = await adminRouter(req, res);
  if (!router) return;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const b = parsed.data;
  const port = b.port ?? defaultPort(b.conn, b.tls);
  try { await probe({ ...b, port }); }
  catch (e) { return res.status(422).json({ error: `Could not connect: ${e.message}`, kind: e.kind ?? 'error' }); }

  const { data, error } = await sb.from('routers').update({
    host: b.host, port, conn: b.conn, tls: b.tls, username: b.username,
    secret_ciphertext: encrypt(b.password), status: 'online', last_error: null,
    last_seen_at: new Date().toISOString(),
  }).eq('id', router.id).select(PUBLIC_COLS).single();
  if (error) throw error;
  res.json(data);
}));

app.post('/routers/:id/sync', requireUser, wrap(async (req, res) => {
  const router = await adminRouter(req, res);
  if (!router) return;
  const result = await syncRouter(sb, router);
  res.status(result.ok ? 200 : 422).json(result);
}));

// Hotspot user profiles on the router, so plans can pick a profile that exists.
app.get('/routers/:id/profiles', requireUser, wrap(async (req, res) => {
  const router = await adminRouter(req, res);
  if (!router) return;
  let client;
  try {
    client = await connectRouter(routerConfig(router));
    const rows = await client.print('/ip/hotspot/user/profile');
    res.json(rows.map((p) => ({
      name: p.name, rateLimit: p['rate-limit'] ?? null, sharedUsers: p['shared-users'] ?? null,
    })));
  } catch (e) {
    res.status(422).json({ error: e.message, kind: e.kind ?? 'error' });
  } finally {
    await client?.close();
  }
}));

app.delete('/routers/:id', requireUser, wrap(async (req, res) => {
  const router = await adminRouter(req, res);
  if (!router) return;
  const { error } = await sb.from('routers').delete().eq('id', router.id);
  if (error) throw error;
  res.status(204).end();
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message ?? 'internal error' });
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, process.env.HOST ?? '127.0.0.1', () => {
  console.log(`hotzonex-router-api listening on ${port}`);
});

const interval = Number(process.env.SYNC_INTERVAL_MS ?? 60000);
setInterval(() => syncAll(sb), interval);
syncAll(sb);

// Wall-clock expiry ("valid within 1 day") even while a router is offline.
setInterval(async () => {
  const { error } = await sb.rpc('expire_vouchers');
  if (error) console.warn('[expire]', error.message);
}, 60000);
