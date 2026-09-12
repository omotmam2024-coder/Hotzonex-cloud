# Architecture

## Constraints that shape everything

| Reality on the ground | Design consequence |
|---|---|
| Sites run on Starlink behind CGNAT: no public IP, no inbound ports | **The cloud never dials into a router.** Routers open an outbound WireGuard tunnel to the VPS. |
| Power is unreliable; routers vanish for hours | Every router operation is a **queued job**. Offline is a normal state; jobs wait for the router instead of failing. |
| Bandwidth is metered, latency high | Conservative polling (default 5 min, per-tenant setting), `.proplist` on every RouterOS read, logs fetched on demand only, no periodic full dumps. |
| SSP primary, USD secondary; cash dominates | Money is integer minor units + ISO code (`packages/shared/src/money.ts`). No payments in Phase 1. |

## Three planes

```
┌──────────────────────────── Browser / PWA (Vercel) ────────────────────────────┐
│ React + Vite + Tailwind + Radix. Supabase JS with the ANON key and the user's   │
│ session. Never sees the service-role key, the encryption key, or credentials.   │
└───────────────┬─────────────────────────────────────────────────────────────────┘
                │ HTTPS (PostgREST, Auth) + WSS (Realtime)  — RLS decides everything
┌───────────────▼──────────────── Data plane: Supabase ───────────────────────────┐
│ Postgres: all business records, RLS on every table, audit via triggers,         │
│ job queue, connector RPCs (service role only). Auth: identity, invite or        │
│ super-admin approval required.                                                  │
│ Realtime: live router status / job progress to the UI.                           │
└───────────────▲─────────────────────────────────────────────────────────────────┘
                │ supabase.rpc() with the SERVICE-ROLE key (server-side only)
┌───────────────┴──────────── Control plane: Connector (VPS) ─────────────────────┐
│ Long-running Node process. Claims jobs, runs them, polls health, reconciles      │
│ WireGuard peers, holds the only copy of ENCRYPTION_KEY. Inbound: GET /healthz.   │
└───────────────┬─────────────────────────────────────────────────────────────────┘
                │ wg0 (10.77.0.1/16) — each router dials OUT, persistent keepalive
      MikroTik 10.77.0.2   MikroTik 10.77.0.3   …   (RouterOS API 8728 inside the tunnel)
```

Serverless cannot do the control plane's job: the RouterOS API is a stateful TCP
session, WireGuard needs a long-lived interface, and polling needs a scheduler.

## Components

### `packages/mikrotik` (no Supabase, no business logic)

- `MikrotikProvider` — the Phase 1 read surface (connect, test, identity, version,
  resources, interfaces, addresses, hotspot servers/profiles/users/active, logs,
  health, current user's policies). Hotspot-user writes arrive in Phase 2 as a
  separate `HotspotUserWriter` interface (see DECISIONS).
- `RouterosApiProvider` — binary API over 8728/8729, written from MikroTik's
  published wire format (length-prefixed words, tagged sentences, `!re` `!done`
  `!trap` `!fatal` and RouterOS 7.18's `!empty`).
- `RouterosRestProvider` — REST over www-ssl / www.
- `MockMikrotikProvider` — deterministic fixtures per host, live-varying CPU/memory,
  injectable failures (offline, timeout, auth failure, API disabled, malformed reply),
  records every call.
- `MikrotikError` — closed set of 11 codes. Every failure maps to one; the UI maps
  each to a sentence (`packages/shared/src/errors.ts`).
- `RouterConnectionPool` — one serialized session per router, hard timeout, circuit
  breaker (3 failures → open; cooldown doubles with jitter; half-open probe).
- `setup-script.ts` — the RouterOS onboarding script generator. The only place
  RouterOS command strings exist (a test enforces this).

### Data plane (`supabase/migrations`)

| Migration | Contents |
|---|---|
| `…100_core_tenancy` | tenants, profiles, invites (+ deny-all token table), authorization helpers in schema `app`, invite-only sign-up trigger, system settings |
| `…200_locations_routers` | locations, routers, WireGuard address pool, mirror tables (interfaces, hotspot servers/profiles), metrics, drift, credentials (deny-all) |
| `…300_jobs` | job registry, jobs, `enqueue_router_job`, `submit_router_credentials` |
| `…400_audit` | immutable audit log, row-change triggers, login/logout from `auth.sessions` |
| `…500_connector` | connector status, service-role RPCs: claim/start/finish jobs, health poll, non-destructive sync + drift, credentials, WireGuard, retention |
| `…600_realtime` | publication for routers, jobs, drift, connector status |
| `…700_envelope_fix_auth_audit_fallback` | error envelope fix, auth audit fallback when `auth.sessions` triggers can't fire |
| `…800_signup_trigger_deferred` | sign-up trigger deferred to commit, so Auth's two-step admin `createUser()` write is seen whole |
| `…201942_pending_accounts` | accounts created outside the invite flow (Supabase dashboard, Auth Admin API) wait for a SUPER_ADMIN to grant a role instead of being rejected |

**Tenancy.** Every business table has `tenant_id`; child tables reference
`(router_id, tenant_id)` with composite foreign keys so a row can never point
across tenants. Policies use `app.staff_in_tenant()`, `app.operator_of()`,
`app.admin_of()` (SECURITY DEFINER, `search_path=''`).

**Column ownership.** Users can only write the columns they own (column-level
grants). Status, telemetry, discovery results, tunnel address, credential state and
the DEMO flag are connector/database-owned; an attempt to set them is rejected.

**MikroTik ids.** RouterOS ids (`*1A`) are unique per router only; every mirror
table is unique on `(router_id, mikrotik_id)`.

### Connector (`apps/connector`)

Independent loops (a failure in one never stops the others; each backs off on error):

| Loop | Interval | Does |
|---|---|---|
| heartbeat | 30 s | publishes version, mode, sealing public key, WireGuard endpoint |
| jobs | `JOB_POLL_INTERVAL_SECONDS` (10 s) | claims and runs jobs (concurrency 4, one session per router) |
| health | 5–15 s tick | polls routers whose interval elapsed, staggered |
| wireguard | 15 s | reconciles wg0 peers with the database, records handshakes |
| retention | 1 h | deletes health samples past retention (30 days default) |

## Flows

### Job lifecycle

```
UI ── enqueue_router_job(router, type, idempotency_key) ──▶ jobs: pending
        (role, tenant, payload and rate limits checked in SQL; an identical
         unfinished job is reused instead of queueing a duplicate)
connector ── connector_claim_jobs (UPDATE … FOR UPDATE SKIP LOCKED) ──▶ claimed
  router known offline (breaker open) and job waits for routers? ──▶ pending, run_after = later (no attempt used)
  connector_start_job ──▶ running (attempts + 1)
  success ──▶ succeeded (+ result)            ── audit: router.<type>.succeeded
  failure ──▶ router offline & waits  → pending, attempt refunded
              destructive job          → failed (never auto-retried; human confirms)
              retryable, attempts left → pending, exponential backoff + jitter
              retryable, exhausted     → dead ── audit: router.<type>.dead
              not retryable            → failed (auth, permissions, TLS…)
health poll finds router back ──▶ connector_release_router_jobs → deferred jobs run now
claim lease (5 min) expires on a crashed connector ──▶ another connector re-claims; handlers are idempotent
```

### Credentials (never in the browser's storage, the API, the logs, or plaintext at rest)

1. The connector derives a P-256 key pair from `ENCRYPTION_KEY` (HKDF, per key
   version) and publishes the **public** half in `connector_status`.
2. The browser seals `{username, password}`: ephemeral ECDH → HKDF-SHA256
   (info includes the router id) → AES-256-GCM (AAD = router id). It calls
   `submit_router_credentials` with only the envelope.
3. The database stores the envelope in a deny-all table and queues
   `router.ingest_credentials`.
4. The connector opens the envelope, re-encrypts the password with AES-256-GCM
   under `ENCRYPTION_KEY` (router id as AAD, key version stored), and deletes the envelope.
5. No API returns credentials, even masked. The UI shows only "Credentials set / not set".

Proof lives in tests: `apps/connector/test/credentials.test.ts` (password absent
from every table readable by users, from the whole database except as
ciphertext, and from all log output), `supabase/tests/rls.test.ts` (no API role can
read the credential tables or call the functions that return ciphertext),
`apps/web/e2e/onboarding.spec.ts` (absent from every network response and browser
storage), `apps/web/e2e-ui/screens.spec.ts` (generated password not persisted).

### Non-destructive sync and drift

Sync only **reads** the router. Hotzonex mirrors what it sees; items that vanish are
marked `removed_at`, never deleted. When the router no longer matches what
Hotzonex relies on (selected hotspot server gone/disabled/renamed, default profile
gone/renamed) a `sync_drift` row is recorded and shown on the router's Hotspot tab.
Drift is never auto-resolved; a technician acknowledges it.

### Status model

- Reachable: `online`, or `warning`/`critical` from CPU, memory and sensor thresholds.
- Missed polls: `warning` after one miss, `offline` after N consecutive misses
  (setting, default 2). `last_seen_at` changes only on success.
- Never polled: `unknown`.
- Routers whose breaker is open are not contacted; the missed poll is still recorded.
- DEMO routers are served by the mock provider and excluded from every count.

## Security model (summary)

- RLS on every table, explicit per-role policies; tests run with Supabase's
  permissive default grants so RLS and explicit revokes are what is being proven.
- Only `get_invite` is callable by `anon`; eleven functions by `authenticated`
  (allow-list test). All `connector_*` functions are service-role only.
- Audit log: written by triggers/SECURITY DEFINER only; UPDATE/DELETE/TRUNCATE
  rejected by trigger for every role including the service role.
- Sign-up needs a valid invite token, enforced in a deferred trigger on
  `auth.users`. An account created without one (Supabase dashboard, Auth
  Admin API) gets no profile and no access until a SUPER_ADMIN grants a role.
- Web: strict CSP (no inline script), session in Secure SameSite=Strict cookies.
- Connector: redacting structured logger, config errors never echo values,
  WireGuard commands via `execFile` with validated arguments.
- Routers: restricted API group (`read,write,api,test`), API service and user
  bound to the tunnel address, no public exposure.

## What is mocked versus real

**Exercised for real in this repository's tests**
- Every migration, RLS policy, trigger and RPC — on Postgres 18 (PGlite).
- Connector job runner, health poller, sync, credential ingest — production code
  against those real SQL functions, with the mock MikroTik provider.
- RouterOS API wire protocol, error mapping, pool and breaker — against an
  in-process fake RouterOS server over real TCP sockets.
- The connector bundle (`dist/main.js`) — booted against an in-memory data plane.
- The web UI — production bundle rendered at 360 px and desktop.

**Exercised against the hosted stack**
- Every migration is applied to the hosted Supabase project, with RLS enabled on
  every public table and no `anon` policy on any of them.
- The onboarding E2E suite, against hosted Supabase with a mock connector.
- The web bundle on Vercel: SPA rewrites, CSP/HSTS and asset caching verified on
  the deployed origin.

**Written but not yet executed against the real thing**
- A real RouterOS device or CHR (`pnpm test:live` exists, skipped by default).
- The `auth.sessions` login/logout trigger and Realtime delivery against a real
  Supabase stack.
- The Playwright E2E suite beyond the onboarding spec (`pnpm test:e2e`).
- The `wg` CLI path on a Linux VPS; the Docker image; the systemd unit.

**Simulated by design**
- `MockMikrotikProvider` (development; DEMO routers always).
- `SimulatedWgManager` when `MIKROTIK_PROVIDER=mock` — pretends every peer has
  just shaken hands. The UI shows a MOCK banner in this mode.
