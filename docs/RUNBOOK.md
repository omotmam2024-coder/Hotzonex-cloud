# Runbook

## 1. Local development

Prerequisites: Node ≥ 22 (24 recommended), pnpm 10 (`npm i -g pnpm@10`), Docker Desktop.

```bash
pnpm install
cp supabase/.env.example supabase/.env
pnpm db:migrate
```

`db:migrate` starts the local Supabase stack (first run downloads images), applies
migrations, and prints the values to copy:

| File | Keys |
|---|---|
| `supabase/.env` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SEED_ADMIN_PASSWORD` |
| `apps/web/.env.local` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| `apps/connector/.env` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY` (`openssl rand -base64 32`), `ENCRYPTION_KEY_VERSION=1`, `MIKROTIK_PROVIDER=mock` |

```bash
pnpm db:seed    # tenant, Lologo One / Gorom / Juba, 3 DEMO routers, admin@hotzonex.com
pnpm dev        # http://127.0.0.1:5173  + connector in mock mode
```

### Simulating router conditions (mock mode)

Every router is served by the mock provider when `MIKROTIK_PROVIDER=mock` (DEMO
routers always are). Flip a router's condition to watch the system react:

```bash
pnpm --filter @hotzonex/connector mock:router <router-id|tunnel-ip> offline
#   online | offline | timeout | auth_failed | api_disabled | permission_denied | malformed
pnpm --filter @hotzonex/connector mock:router list
```

Power a router "off" and within two poll intervals it shows **Offline** with its
last-seen time preserved; queue a Sync and it waits; set it back to `online` and
the sync runs by itself.

### Tests

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm --filter @hotzonex/web test:ui          # UI at 360 px + desktop, backend intercepted
pnpm --filter @hotzonex/connector build && pnpm --filter @hotzonex/connector smoke
```

`pnpm test` needs no Docker: database tests run every migration on PGlite (Postgres 18
in WebAssembly) with a shim that reproduces Supabase's roles, `auth.uid()` and its
permissive default grants.

### Running the E2E suite

With the local stack running, seeded, and the connector in mock mode:

```bash
pnpm --filter @hotzonex/connector dev        # terminal 1
E2E_ADMIN_PASSWORD='<SEED_ADMIN_PASSWORD>' pnpm test:e2e   # terminal 2 (starts the web app)
```

### Live router test (optional)

```bash
MIKROTIK_LIVE=1 MIKROTIK_LIVE_HOST=10.77.0.5 MIKROTIK_LIVE_USER=hotzonex-api \
MIKROTIK_LIVE_PASSWORD='…' pnpm test:live       # read-only
```

A free MikroTik **CHR** VM works for this.

## 2. Production deployment

### 2.1 Supabase (data plane)

1. Create a project (region closest to the VPS; latency to Juba matters less than
   VPS↔Supabase latency, since the connector does most of the traffic).
2. Auth → Sign-ups: keep enabled (the database rejects sign-up without a
   valid invite token). Set the **Site URL** to the Vercel domain. Keep email
   confirmation on. Auth → Rate limits: keep defaults or tighten.
   Accounts added directly in Auth → Users (or via the Admin API) get no
   profile and see "No access yet" until a SUPER_ADMIN grants a role from
   Settings → Team → Waiting for access.
3. Apply migrations: set `SUPABASE_DB_URL` in `supabase/.env` to the project's
   connection string, then `pnpm db:migrate` (it runs `supabase db push`).
4. Seed: set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SEED_ADMIN_PASSWORD` and
   run `pnpm db:seed`. Remove the DEMO routers from the UI when no longer wanted.

### 2.2 Web (Vercel, GitHub import)

1. Vercel → Add New → Project → import the GitHub repository.
2. **Root Directory:** `apps/web`. Framework: Vite (from `apps/web/vercel.json`).
   Vercel installs the pnpm workspace from the repo root automatically.
3. Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — nothing else.
4. Deploy. `vercel.json` adds SPA rewrites and security headers. If Supabase is on
   a custom domain, add it to `connect-src` in the CSP.

**If the Root Directory is wrong, the build still reports success.** Vercel then
runs the root `pnpm -r build` (or the wrong package's), publishes whatever `dist`
it finds — the connector's esbuild bundle, say — and marks the deployment READY
while the site serves 404 at `/`. Everything in `vercel.json` resolves relative
to the Root Directory, so a stray `vercel.json` at the repo root does not fix it
and the SPA rewrite and CSP headers silently go missing. Symptoms and check:

| Symptom | Check |
|---|---|
| `/` returns 404 on a READY deployment | Build log line `> @hotzonex/<pkg> build` — must be `web` |
| `/` works, deep links 404, no CSP header | `apps/web/vercel.json` is not being read → Root Directory |

```bash
vercel project update hotzonex.net --root-directory apps/web \
  --auto-detect build-command --auto-detect output-directory --yes
curl -sI https://<domain>/settings | head -1        # expect 200, not 404
curl -sI https://<domain>/ | grep -i content-security-policy
```

### 2.3 Connector on a VPS

Any small Linux VPS with a public IPv4 (1 vCPU / 1 GB is plenty for hundreds of
routers). Ubuntu 24.04 shown.

**a. WireGuard server interface (once)**

```bash
sudo apt update && sudo apt install -y wireguard-tools
wg genkey | sudo tee /etc/wireguard/server.key | wg pubkey | sudo tee /etc/wireguard/server.pub
sudo chmod 600 /etc/wireguard/server.key
sudo tee /etc/wireguard/wg0.conf >/dev/null <<EOF
[Interface]
Address = 10.77.0.1/16
ListenPort = 51820
PrivateKey = $(sudo cat /etc/wireguard/server.key)
SaveConfig = false
# No [Peer] sections: the connector adds and removes router peers at runtime.
EOF
sudo systemctl enable --now wg-quick@wg0
```

The address **must** be `10.77.0.1/16`: the database allocates router addresses
from that pool. Peers added at runtime are lost when wg0 restarts; the connector
re-adds them within 15 seconds.

**b. Firewall** — inbound UDP 51820 (WireGuard) and SSH only. Do not expose 8728,
8729 or 8080. `/healthz` stays on localhost unless an uptime monitor needs it (then
allow only the monitor's IP).

```bash
sudo ufw allow OpenSSH && sudo ufw allow 51820/udp && sudo ufw enable
```

**c. Connector configuration** — `apps/connector/.env` (Docker) or
`/etc/hotzonex/connector.env` (systemd), mode `0600`:

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=…
ENCRYPTION_KEY=<openssl rand -base64 32>        # back this up offline
ENCRYPTION_KEY_VERSION=1
MIKROTIK_PROVIDER=api
WG_INTERFACE=wg0
WG_SERVER_PUBLIC_KEY=<contents of /etc/wireguard/server.pub>
WG_ENDPOINT=<vps-public-hostname-or-ip>:51820
HEALTHZ_HOST=127.0.0.1
```

**d-1. Run with Docker** (from a checkout of the repository):

```bash
docker compose build connector
docker compose up -d connector
curl -s http://127.0.0.1:8080/healthz
docker compose logs -f connector
```

**d-2. Or run with systemd** (no Docker):

```bash
sudo useradd --system --home /opt/hotzonex-connector --shell /usr/sbin/nologin hotzonex
pnpm install && pnpm --filter @hotzonex/connector build
sudo mkdir -p /opt/hotzonex-connector /etc/hotzonex
sudo cp -r apps/connector/dist /opt/hotzonex-connector/
sudo cp apps/connector/deploy/hotzonex-connector.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now hotzonex-connector
journalctl -u hotzonex-connector -f
```

**e. Verify.** Settings → System in the web app shows the connector **Online**, its
mode, and its WireGuard endpoint within 30 seconds.

## 3. Operations

### Health

- `GET /healthz` → 200 with loop status, or 503 when the heartbeat, job or health
  loop has stalled for 3 intervals. Docker HEALTHCHECK uses it.
- Web → Settings → System: last heartbeat. The sidebar shows **Connector offline**
  if it stops reporting for 90 seconds.
- Logs are JSON on stdout. Fields: `component`, `routerId`, `jobId`, `code`.
  Secrets are redacted by path and never passed to the logger.

### Rotating the encryption key

1. Generate a new key: `openssl rand -base64 32`.
2. Set `ENCRYPTION_KEYS_RETIRED=<old version>:<old key>`, `ENCRYPTION_KEY=<new>`,
   `ENCRYPTION_KEY_VERSION=<old + 1>`. Restart the connector.
   (Envelopes sealed by browsers to the old key still open during this window.)
3. `pnpm --filter @hotzonex/connector rekey` (or `node dist/rekey.js` in the
   container) — re-encrypts every stored password with the new version.
4. When it reports `0 could not be decrypted`, remove `ENCRYPTION_KEYS_RETIRED`
   and restart.

**Losing `ENCRYPTION_KEY` loses every router credential.** Keep it in a password
manager or offline backup, never in the repository.

### Incident playbook

| Symptom | Check | Action |
|---|---|---|
| Connector shows offline | `systemctl status` / `docker compose ps`; `/healthz`; logs for `loop iteration failed` | Restart; verify `SUPABASE_URL`/key; check VPS outbound HTTPS |
| One router offline | Router page → Tunnel "last handshake"; Reason | Power/Starlink at site. Jobs wait; nothing to do in Hotzonex |
| Router online in tunnel but tests fail with **Port blocked** | Router firewall | Move the "Hotzonex Cloud API via tunnel" rule above drop rules |
| **Login rejected** | Someone changed the API user | Re-run the onboarding script (Resume onboarding) or Replace credentials |
| **Credentials could not be read** | Encryption key changed without rotation | Re-enter credentials for affected routers |
| All routers offline at once | `wg show wg0` on the VPS; UDP 51820 reachable? | Restart `wg-quick@wg0` then the connector |
| Jobs stuck "Queued" | Connector offline? | Jobs run when it returns; they expire after 7 days if the router never comes back |

### Backups

Supabase: enable daily backups / PITR on the project. The connector is stateless
apart from `ENCRYPTION_KEY`.
