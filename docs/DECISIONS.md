# Decisions

Each entry: the decision, why, and what it means for later phases. Items marked
**(owner-approved)** were confirmed before the build started.

## Stack and layout

**D1. Web: React + Vite (not Next.js), React Router, TanStack Query, Tailwind v4, Radix/shadcn-style components.** The browser talks straight to Supabase; the web tier needs no server. Next.js server features would sit unused or invite logic into the wrong plane. Vite's PWA story is simpler.

**D2. TypeScript 6.0, not 7.** typescript-eslint supports `< 6.1`. Revisit when it supports the Go compiler.

**D3. The previous Next.js/Prisma scaffold was replaced, not migrated (owner-approved).** It stored router passwords in plain text and returned them from the API, had no tenancy, and dialed routers directly. It is preserved in the first git commit.

## Security

**D4. Credential sealing.** The browser collects router credentials, but only the connector holds `ENCRYPTION_KEY`. The browser encrypts to a P-256 public key the connector publishes (ECDH + HKDF + AES-GCM, bound to the router id), so plaintext never reaches the database. The sealing key is *derived* from `ENCRYPTION_KEY` per key version — no extra secret, it survives restarts, and it rotates with the encryption key.

**D5. The onboarding password is generated in the browser (owner-approved).** The router script must contain the API user's password, so the browser generates it (CSPRNG, 32 alphanumeric chars), shows it once, and seals it. It is never persisted or returned by any API. Losing it means generating a new one.

**D6. The router generates its own WireGuard key pair (owner-approved).** The script prints the public key; the admin pastes one line back. The private key never leaves the router.

**D7. Session cookies are Secure + SameSite=Strict, not HttpOnly.** The browser Supabase client and Realtime need the access token, so it cannot be HttpOnly in this architecture (true of Next.js too, without proxying all data access through a server). Mitigated by a strict CSP (no inline script, no third-party script).

**D8. Auth rate limiting is Supabase Auth's own** (`supabase/config.toml` `[auth.rate_limit]`, tightened), plus a client-side courtesy throttle. Connection tests are rate-limited in SQL (6 per router per minute; 60 user jobs per tenant per minute).

**D9. Invite-only sign-up (owner-approved).** Enforced by a trigger on `auth.users`: a profile is created only for a valid, unexpired invite token matching the email, or for accounts provisioned by the seed via the admin API (`app_metadata` is not user-writable). Admins share the invite link themselves; there is no email sending in Phase 1.

**D10. Login/logout audit from `auth.sessions` triggers.** Browser-written audit rows would be forgeable. Session rows are created on sign-in and deleted on sign-out. Expired sessions cleaned up by Supabase are also recorded as logout, with `reason: session_ended`. The trigger reads columns via `jsonb` and swallows its own errors so it can never block sign-in. *Risk:* Supabase could restrict triggers on the `auth` schema; verify on the target project.

**D11. `ENCRYPTION_KEYS_RETIRED` (new env var).** Key rotation needs the old key available for decryption until `rekey` has run. Optional; empty outside rotations.

**D12. TLS verification is off inside the tunnel for api-ssl/REST.** RouterOS ships self-signed certificates and WireGuard already authenticates the peer and encrypts traffic. The UI recommends plain API (8728) for this reason.

## Data model

**D13. Tables added beyond the spec's list:** `invites` + `invite_tokens` (D9), `router_credential_submissions` (D4), `sync_drift` (§8 drift entries), `job_types` (retry policy registry, mirrored in `packages/shared/src/jobs.ts`, test-enforced), `connector_status` (heartbeat, sealing key, WireGuard endpoint).

**D14. Columns added to `routers`:** `wg_last_handshake_at` (§2), `status_reason`, `last_polled_at`, `consecutive_failures`, latest resource snapshot (`cpu_load`, `free_memory`, `total_memory`, `uptime_seconds`) so list pages need no time-series scan, `credentials_status`, `hotspot_server_id`, `default_hotspot_profile_id`, `discovered_at`, `onboarding_completed_at`, `notes`, `created_by`. `router_metrics.reachable` records failed polls so uptime is honest.

**D15. Global (non-tenant) tables:** `job_types` and `connector_status` hold no tenant data; both are readable by staff and writable only by the service role.

**D16. WireGuard pool 10.77.0.0/16, server 10.77.0.1.** One VPS interface serves every tenant, so addresses are globally unique and allocated by a SECURITY DEFINER function under an advisory lock (skips `.0`/`.255`). Capacity about 65,000 routers per connector interface. Multi-VPS sharding would add a pool per connector — the `connector_status` table already supports multiple instances.

**D17. `host` vs `wg_address`.** `wg_address` is the allocated tunnel address; `host` is what the connector dials, defaulting to the tunnel address. They diverge only in the future site-agent mode (D25).

## Jobs and sync

**D18. Job types.** `router.test_connection`, `router.test_permissions`, `router.sync` (discovery and sync are one read-only job), `router.fetch_logs`, `router.ingest_credentials`. Health polling is the connector's own scheduler, not jobs.

**D19. Retry policy.** Offline routers defer jobs *without consuming attempts* (up to a 7-day expiry). Retryable errors back off exponentially (30 s base, 1 h cap, ±20 % jitter). Non-retryable errors (auth, permissions, TLS, invalid command) fail immediately. Single-shot jobs (tests, logs) report `failed` rather than `dead`. **Destructive jobs never auto-retry** — Phase 1 has none; the policy is implemented and tested with a test-only job type, ready for Phase 2 delete/disconnect.

**D20. "Dead + notification":** notifications are out of scope, so dead jobs are visible on the router page and recorded in the audit log (`router.<type>.dead`). Phase 4 notifications can subscribe to the same audit/job transitions.

**D21. Sync runs on demand and at onboarding, not on a timer.** Metered links: health polls already refresh version, board and resources. RouterOS has no delta query, so a sync always reads the lists (kept small with `.proplist`); the *database* writes only changes.

**D22. Drift is recorded for what Hotzonex relies on:** the selected hotspot server (removed, disabled, invalid, renamed) and the default profile (removed, renamed). Never auto-resolved.

## MikroTik layer

**D23. Phase 1 `MikrotikProvider` is read-only.** The spec's hotspot-user write methods are Phase 2; stubbing them is banned, so they will arrive as a separate `HotspotUserWriter` interface that providers also implement — an addition, not a rewrite (owner-approved).

**D24. `MIKROTIK_PROVIDER=api|rest` both mean "real routers"; each router's own `api_protocol` picks the binary API or REST.** A fleet can mix both. `mock` serves every router from the mock provider; DEMO routers are always mock-served.

**D25. Site-agent fallback (documented, not built).** For sites where WireGuard is impossible, a small local device would poll Supabase for its site's jobs with a per-site credential and talk to the router over the LAN. The job table, RPC boundary and `routers.host` already accommodate it: the agent would be a second `ConnectorStore` client scoped to one site.

## Testing

**D26. Database tests run on PGlite**, not a Supabase container, because the build machine has no Docker. A shim creates Supabase's roles, `auth.uid()`, and — deliberately — Supabase's permissive default grants, so the tests prove RLS and explicit revokes do the protecting. The same SQL is what `supabase db push` applies.

**D27. Types are generated from the migrations.** `pnpm db:types` uses the Supabase CLI against the running stack; `pnpm db:types:offline` introspects PGlite and emits the same `Database` shape. Row types are never hand-written.

## Later phases — constraints recorded now

- **Money (Phase 3):** integer minor units + ISO code; `tenants.currency_default` exists. Payment rows must follow `packages/shared/src/money.ts`.
- **Packages ↔ profiles (Phase 2):** map by `hotspot_profiles.id` (a Hotzonex id), never by RouterOS `.id` or name alone — names can drift (D22).
- **Hotspot users (Phase 2):** creation must be idempotent on the router (look up by name before `add`), with `ALREADY_EXISTS` treated as success when the existing user matches.
- **Resellers/customers:** roles exist and have explicit, currently empty, access; Phase 3/4 adds policies, not new role plumbing.
