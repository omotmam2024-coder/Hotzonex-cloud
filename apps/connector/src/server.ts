import http from 'node:http';

export interface HealthReport {
  ok: boolean;
  body: Record<string, unknown>;
}

/**
 * The connector's only inbound surface: GET /healthz for Docker/systemd/uptime
 * checks. No secrets, no router data, no other routes.
 */
export function startHealthServer(host: string, port: number, report: () => HealthReport): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/healthz/')) {
      const r = report();
      res.writeHead(r.ok ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(r.body));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  server.headersTimeout = 5_000;
  server.requestTimeout = 5_000;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}
