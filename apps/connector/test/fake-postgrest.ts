/**
 * A tiny stand-in for PostgREST's RPC endpoint (POST /rest/v1/rpc/<fn>) backed
 * by PGlite, so the real supabase-js client and SupabaseTransport can be
 * exercised without Docker. It checks the service-role key the way Supabase's
 * gateway would (apikey header) and applies the same role/claims as PostgREST.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PGlite } from '@electric-sql/pglite';
import { as, rpc } from '@hotzonex/db/testing';

export async function startFakePostgrest(db: PGlite, serviceKey: string): Promise<{ url: string; requests: string[]; close(): Promise<void> }> {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      void (async () => {
        const match = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(req.url ?? '');
        if (req.method !== 'POST' || !match) {
          res.writeHead(404).end();
          return;
        }
        if (req.headers['apikey'] !== serviceKey || req.headers['authorization'] !== `Bearer ${serviceKey}`) {
          res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ message: 'Invalid API key' }));
          return;
        }
        const fn = match[1] as string;
        requests.push(fn);
        try {
          const args = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>) : {};
          const meta = await db.query<{ retset: boolean; rettype: string; nout: number }>(
            `select p.proretset as retset, p.prorettype::regtype::text as rettype,
                    coalesce(array_length(array(select 1 from unnest(p.proargmodes) m where m in ('o','t','b')), 1), 0) as nout
               from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`,
            [fn],
          );
          const m = meta.rows[0];
          if (!m) {
            res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ message: `function ${fn} not found` }));
            return;
          }
          const rows = await as(db, { kind: 'service' }, (tx) => rpc(tx, fn, args));
          if (m.rettype === 'void') {
            res.writeHead(204).end();
          } else if (m.retset || m.nout > 0) {
            res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(rows));
          } else {
            const value = (rows[0] as Record<string, unknown> | undefined)?.[fn] ?? null;
            res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value));
          }
        } catch (error) {
          res.writeHead(400, { 'content-type': 'application/json' })
            .end(JSON.stringify({ message: (error as Error).message, code: (error as { code?: string }).code ?? 'P0001' }));
        }
      })();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
