# Hotzonex Cloud

WiFi hotspot management for Hotzonex: create vouchers, push them to MikroTik routers, sell them (cash or agent codes), track active and expired users, report sales, and keep an inventory of every network device. Works on desktop and phone (installable as an app).

```
Browser / phone app (React, Vercel)
  ├─ Supabase (Postgres + Auth + RLS) ── vouchers, sales, plans, agents, devices, reports
  └─ HTTPS ─► Router API (Node, your VPS, behind Caddy)
                 └─ WireGuard 10.99.0.1 ◄── each MikroTik dials in (10.99.0.x)
```

Routers sit behind Starlink CGNAT, so they dial **out** to the VPS over WireGuard. The VPS talks to them over the tunnel. Router passwords are encrypted (AES-256-GCM) on the VPS and never reach the browser.

## What's in the box

| Folder | What it is |
|---|---|
| `src/` | The web app: Dashboard, Sell, Vouchers (+ print cards), Active users, Expired, Sales (+ CSV), Reports, Routers (+ onboarding wizard), Devices, Settings (plans, sites, agents, staff, business) |
| `supabase/setup.sql` | The whole database in one file (tables, security rules, functions, report views) |
| `supabase/migrations/` | Same, as two migrations, for the Supabase CLI |
| `supabase/tests/` | Lifecycle test that runs the database on plain Postgres |
| `router-api/` | VPS service: adds/tests routers, syncs every 60 s (push vouchers, read usage, expire, remove) |
| `vps/` | `install.sh` (one-shot VPS setup), `wg-add-peer.sh`, systemd unit, Caddyfile |
| `mikrotik/onboard-router.rsc` | Router script (the Routers page also generates a filled-in copy) |

## Roles

| Role | Can do |
|---|---|
| Owner | Everything, including adding other owners |
| Admin | Vouchers, routers, plans, sites, agents, staff, reports |
| Cashier / Agent | Sell, see sales, active and expired users, devices. Pinned to one site if you set one |

## Deploy — 4 steps

### 1. Database (Supabase)
1. Create a new Supabase project (region: eu-central-1 is closest that you already use).
2. SQL Editor → paste all of `supabase/setup.sql` → **Run**.
3. Authentication → URL Configuration → set **Site URL** to your Vercel address (e.g. `https://hotzonex-cloud.vercel.app`).
4. Optional: Authentication → Providers → Email → turn off "Confirm email" if staff don't have reliable email.

### 2. Web app (Vercel)
1. Push this folder to `omotmam2024-coder/Hotzonex_cloud` (replace the old contents).
2. In the Vercel project → Settings → Environment Variables, add the values from `.env.example`:
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ROUTER_API_URL`, `VITE_VPS_ENDPOINT`, `VITE_VPS_WG_PUBLIC_KEY`.
3. Redeploy. Open the site, **Create an account**, then **Create business** — you become the owner.

### 3. VPS (router API + WireGuard hub)
1. Point a DNS name at the VPS, e.g. `api.hotzonex.com` → VPS IP.
2. Copy this folder to the VPS and run:
   ```bash
   sudo API_DOMAIN=api.hotzonex.com bash vps/install.sh
   ```
3. Edit `/opt/hotzonex-router-api/.env`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Settings → API), `ALLOWED_ORIGINS` (your Vercel URL).
4. `sudo systemctl restart hotzonex-router-api` and check `curl https://api.hotzonex.com/health` → `{"ok":true}`.
5. Open **UDP 51820** and **TCP 80, 443** in the VPS provider's firewall.
6. Put the printed VPS WireGuard key into Vercel as `VITE_VPS_WG_PUBLIC_KEY` and redeploy.
7. **Back up** `ROUTER_SECRET_KEY` from the `.env` somewhere offline. Without it every stored router password is unreadable.

### 4. Each site
1. Settings → Sites: add Gorom, Jebel Iraq Head Office, Jebel Iraq Sub Office with their hours. Set **Hotspot server** to the exact RouterOS hotspot server name (or `all`).
2. Settings → Plans: add each site's plans and prices (e.g. Sub Office: LITE, Popular, Power, Max). The **hotspot profile** must exist on that router; use "Load from router" once it's connected.
3. Routers → **Add router**: the wizard generates the script for Winbox, gives you the `wg-add-peer.sh` command for the VPS, then tests and saves the router.
4. Vouchers → **Generate** a batch. About a minute later they show "On router: yes". Print cards or sell from the Sell screen.
5. Settings → Agents and Staff.

## How the voucher lifecycle works

1. **Generate** — 8-digit numeric codes by default (easy on phone keypads, hard to guess).
2. **Push** — the router API adds each to `/ip/hotspot/user` with `limit-uptime`, optional `limit-bytes-total`, and `comment=hzc:<id>`. Safe to retry after power cuts: it checks by name first.
3. **Sell** — one tap; exactly one sales row; locks so two cashiers never get the same code.
4. **Activate** — first login sets it Active. If the card was printed and handed out without pressing Sell, a cash sale is recorded then (turn off in Settings → Business).
5. **Expire** — when online time, data cap or "valid within" runs out. **Customers are never kicked** for this: the voucher is removed from the router only after they log out.
6. **Disable** — an admin action. That user *is* disconnected on the next sync.

## End-to-end check after deploying

- [ ] Add a router with a wrong password → clear error, nothing saved
- [ ] Add it correctly → status Online, RouterOS version shown
- [ ] Generate 10 vouchers → within a minute `/ip hotspot user print where comment~"hzc:"` lists them
- [ ] Sell one → code shown, one row in Sales, Ready stock drops by 1
- [ ] Log in on a phone with it → appears under Active users within a minute
- [ ] 5-minute test plan → becomes Expired; removed from the router after logout, never mid-session
- [ ] Disable a voucher in use → user disconnected on next sync
- [ ] Pull the router's power → Offline with an error; restore → catches up with no duplicates

## Troubleshooting

| Symptom | Check |
|---|---|
| `cannot reach http://10.99.0.x` | `sudo wg show` handshake age; UDP 51820 open at the provider |
| `wrong username or password` / auth_failed | the router user's `address=` must include 10.99.0.1; group needs `api` + `rest-api` |
| REST 404 | RouterOS older than 7.1 or `www` disabled — switch the router to "RouterOS API (8728)" |
| Vouchers stuck "pending" | hover "error" on the voucher: usually a hotspot profile or server name that doesn't exist on the router |
| Customers get "invalid username or password" on a valid code | site's Hotspot server name doesn't match the router; set it exactly or to `all` |
| Browser says "Cannot reach the router API" | `VITE_ROUTER_API_URL`, Caddy running, `ALLOWED_ORIGINS` includes the Vercel URL |

## Development

```bash
cp .env.example .env      # fill in values
npm install && npm run dev                 # web app on http://localhost:5173
cd router-api && npm install && npm test   # router API unit tests (mock router)
PGHOST=... PGUSER=postgres npm run test:db # database lifecycle test on local Postgres
```
