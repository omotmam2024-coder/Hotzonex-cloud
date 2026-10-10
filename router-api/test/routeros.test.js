// Run: npm test   (no router or Supabase needed — uses a mock RouterOS REST server)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

process.env.ROUTER_SECRET_KEY = crypto.randomBytes(32).toString('base64');
const { encrypt, decrypt } = await import('../src/crypto.js');
const { toRosTime, parseRosTime, connectRouter, RouterError } = await import('../src/routeros.js');

// ---- mock RouterOS v7 REST ------------------------------------------
const users = new Map();
let nextId = 1;
const server = http.createServer((req, res) => {
  const auth = Buffer.from((req.headers.authorization ?? '').replace('Basic ', ''), 'base64').toString();
  if (auth !== 'hzcloud:secret') { res.writeHead(401); return res.end('{"error":401}'); }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url === '/rest/system/resource') return send(200, { version: '7.16.1 (stable)', 'board-name': 'hAP ax2', uptime: '1d2h' });
    if (req.url === '/rest/ip/hotspot/user' && req.method === 'GET') return send(200, [...users.values()]);
    if (req.url === '/rest/ip/hotspot/user' && req.method === 'PUT') {
      const u = JSON.parse(body);
      if ([...users.values()].some((x) => x.name === u.name)) return send(400, { detail: 'failure: already have user with this name' });
      const row = { '.id': `*${nextId++}`, uptime: '0s', 'bytes-in': '0', 'bytes-out': '0', ...u };
      users.set(row['.id'], row);
      return send(201, row);
    }
    const del = req.url.match(/^\/rest\/ip\/hotspot\/user\/(.+)$/);
    if (del && req.method === 'DELETE') { users.delete(decodeURIComponent(del[1])); return send(204, null); }
    if (req.url === '/rest/ip/hotspot/active') return send(200, []);
    send(404, { detail: 'no such command' });
  });
});
let port;
before(() => new Promise((r) => server.listen(0, '127.0.0.1', () => { port = server.address().port; r(); })));
after(() => server.close());

// ---- tests ------------------------------------------------------------
test('RouterOS time conversions round-trip', () => {
  assert.equal(toRosTime(5400), '1h30m');
  assert.equal(toRosTime(86400 + 3600), '1d1h');
  assert.equal(parseRosTime('1h30m'), 5400);
  assert.equal(parseRosTime('1w2d3h4m5s'), 604800 + 2 * 86400 + 3 * 3600 + 245);
  assert.equal(parseRosTime('1d02:03:04'), 86400 + 7384);
  assert.equal(parseRosTime('00:05:00'), 300);
  assert.equal(parseRosTime('500ms'), 0);
  for (const s of [60, 3600, 7200, 86400, 604800 + 61]) assert.equal(parseRosTime(toRosTime(s)), s);
});

test('router passwords encrypt and decrypt, ciphertext differs each time', () => {
  const a = encrypt('p@ss'), b = encrypt('p@ss');
  assert.notEqual(a, b);
  assert.equal(decrypt(a), 'p@ss');
  // Flip one byte of the ciphertext: GCM must reject it.
  const [iv, tag, ct] = a.split('.');
  const bytes = Buffer.from(ct, 'base64'); bytes[0] ^= 0xff;
  assert.throws(() => decrypt([iv, tag, bytes.toString('base64')].join('.')));
});

test('REST client: identity, add, print, remove', async () => {
  const c = await connectRouter({ host: '127.0.0.1', port, conn: 'rest', tls: false, username: 'hzcloud', password: 'secret' });
  const id = await c.identity();
  assert.match(id.version, /^7\./);
  await c.add('/ip/hotspot/user', { name: '12345678', password: '12345678', profile: 'default', 'limit-uptime': '1h', comment: 'hzc:x' });
  const list = await c.print('/ip/hotspot/user');
  assert.equal(list.length, 1);
  await assert.rejects(c.add('/ip/hotspot/user', { name: '12345678' }), (e) => e instanceof RouterError && e.kind === 'error');
  await c.remove('/ip/hotspot/user', list[0]['.id']);
  assert.equal((await c.print('/ip/hotspot/user')).length, 0);
});

test('REST client: wrong password is auth_failed, dead host is offline', async () => {
  const bad = await connectRouter({ host: '127.0.0.1', port, conn: 'rest', tls: false, username: 'hzcloud', password: 'nope' });
  await assert.rejects(bad.identity(), (e) => e.kind === 'auth_failed');
  const dead = await connectRouter({ host: '127.0.0.1', port: 1, conn: 'rest', tls: false, username: 'a', password: 'b' });
  await assert.rejects(dead.identity(), (e) => e.kind === 'offline');
});
