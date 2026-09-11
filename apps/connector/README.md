# @hotzonex/connector

The Hotzonex Cloud control plane: a long-running Node service on a VPS that

- claims router jobs from Supabase and runs them (connection tests, permission
  checks, read-only discovery/sync, log fetches, credential ingestion),
- polls router health on a staggered, conservative schedule,
- keeps the VPS WireGuard peers in line with the routers in the database,
- holds the only copy of `ENCRYPTION_KEY`.

Its only inbound surface is `GET /healthz`.

```bash
pnpm --filter @hotzonex/connector dev      # tsx watch, reads apps/connector/.env
pnpm --filter @hotzonex/connector build    # bundles to dist/ (main.js, rekey.js)
pnpm --filter @hotzonex/connector smoke    # boots dist/main.js against an in-memory data plane
pnpm --filter @hotzonex/connector rekey    # re-encrypt credentials after a key rotation
pnpm --filter @hotzonex/connector mock:router <id|ip> offline   # dev: simulate router conditions
```

Configuration: [.env.example](.env.example). Deployment: [docs/RUNBOOK.md](../../docs/RUNBOOK.md).
`.mock-state.json` (git-ignored) holds simulated router conditions in mock mode.
