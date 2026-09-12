# Hotzonex Cloud

**MikroTik Hotspot Management & WiFi Platform** — Hotzonex WiFi/IT Solutions, Juba, South Sudan.

Phase 1: multi-tenant admin platform to onboard, monitor and audit MikroTik routers
that sit behind Starlink CGNAT, on unreliable power, over metered links.

```
Browser / PWA ──HTTPS, anon key, RLS──▶ Supabase (data plane)
                                          ▲ service-role RPCs
                                          │ (claims jobs, writes results)
                                     Connector on a VPS (control plane)
                                          │ WireGuard — routers dial OUT
                               MikroTik #1   MikroTik #2   MikroTik #3 …
```

The cloud never dials into a router. Each router opens an outbound WireGuard
tunnel to the VPS; the connector reaches it at its tunnel address (10.77.x.y).
Every router operation is a queued job, so offline routers are normal, not errors.

## Quick start (local)

Prerequisites: Node ≥ 22, pnpm 10, **Docker** (for the local Supabase stack).

```bash
pnpm install
cp supabase/.env.example supabase/.env           # set SEED_ADMIN_PASSWORD
pnpm db:migrate                                   # starts local Supabase, applies migrations, prints keys
#   → put the printed URL/keys into supabase/.env, apps/web/.env.local, apps/connector/.env
#   → set ENCRYPTION_KEY in apps/connector/.env:  openssl rand -base64 32
pnpm db:seed                                      # tenant, 3 locations, DEMO routers, admin@hotzonex.com
pnpm dev                                          # web on :5173 + connector (MIKROTIK_PROVIDER=mock)
```

Sign in as `admin@hotzonex.com` with `SEED_ADMIN_PASSWORD`.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Web (Vite) + connector (mock provider) |
| `pnpm build` | Web bundle (PWA) + connector bundle |
| `pnpm lint` / `pnpm typecheck` | ESLint (incl. architecture guards) / TypeScript, all packages |
| `pnpm test` | Unit + integration + RLS tests (Vitest; Postgres via PGlite — no Docker needed) |
| `pnpm test:e2e` | Playwright end-to-end against the real local stack (see RUNBOOK) |
| `pnpm --filter @hotzonex/web test:ui` | Playwright UI checks at 360 px and desktop, backend intercepted |
| `pnpm --filter @hotzonex/connector smoke` | Boots the built connector against an in-memory data plane |
| `pnpm test:live` | Read-only test against a real RouterOS device (`MIKROTIK_LIVE=1`, skipped otherwise) |
| `pnpm db:migrate` / `pnpm db:seed` | Apply migrations (local or `SUPABASE_DB_URL`) / seed |
| `pnpm db:types` | Regenerate Supabase types with the CLI (needs the local stack) |
| `pnpm db:types:offline` | Same types, generated from the migrations via PGlite (no Docker) |
| `docker compose up -d connector` | Connector on a VPS (host network + NET_ADMIN for WireGuard) |

## Repository

```
apps/web             React + Vite PWA (Vercel). Anon key only; RLS enforces access.
apps/connector       Node control plane (VPS, Docker/systemd). Jobs, health polls, WireGuard.
packages/shared      Zod schemas, generated DB types, job registry, money/time, credential sealing.
packages/mikrotik    MikrotikProvider + RouterOS API/REST clients + mock + onboarding script. No Supabase.
supabase             Migrations (schema, RLS, RPCs, audit), seed, DB tests, scripts.
docs                 ARCHITECTURE, RUNBOOK, ROUTER_SETUP, DECISIONS.
```

## What is real, what is mocked

| Area | Status |
|---|---|
| Schema, RLS, RPCs, audit triggers, job lifecycle | Real SQL, tested on Postgres 18 (PGlite) with Supabase's permissive default grants. **Applied to the hosted Supabase project** and in use there: all 9 migrations recorded, RLS enabled on every public table with no `anon` policy, and the deny-all credential/token tables carry no policies at all. |
| RouterOS binary API client | Real implementation of the published protocol (incl. 7.18 `!empty`). Tested against an in-process fake RouterOS server. **Not yet tested against a real router or CHR.** |
| RouterOS REST provider | Real implementation, tested against a fake HTTP endpoint. **Not tested against a real router.** |
| Connector ↔ Supabase transport | Real supabase-js client, tested against a PostgREST stand-in; bundle smoke-tested. |
| WireGuard peer management | `wg` CLI manager is real code, **untested against a real interface**. `wg show dump` parsing is tested. With `MIKROTIK_PROVIDER=mock` a clearly labelled simulated manager is used. |
| MockMikrotikProvider | Used for development and always for DEMO routers. The UI shows a MOCK banner whenever the connector runs in mock mode. |
| Web UI | Rendered and checked at 360 px and 1366 px against an intercepted backend (12 Playwright checks, passing). The onboarding E2E suite has been run against the live stack; the **remaining E2E specs still need the Docker stack**. |
| Web deployment | **Live on Vercel** from `main` (Root Directory `apps/web`): SPA rewrites, CSP/HSTS and immutable asset caching all verified on the deployed origin. |
| Docker image, systemd unit | Written, **not built/run here** (no Docker). |

Details and the riskiest gaps: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#what-is-mocked-versus-real).
