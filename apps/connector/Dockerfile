# Hotzonex Cloud connector image. Build from the repository root:
#   docker build -f apps/connector/Dockerfile -t hotzonex-connector .
# Runs as a non-root user; needs NET_ADMIN (and host networking) to manage the
# VPS WireGuard interface — see docker-compose.yml and docs/RUNBOOK.md.

FROM node:24-bookworm-slim AS build
WORKDIR /repo
RUN npm install -g pnpm@10.34.5
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY supabase/package.json ./supabase/package.json
COPY apps/connector ./apps/connector
RUN pnpm install --frozen-lockfile --filter @hotzonex/connector... \
 && pnpm --filter @hotzonex/connector build

FROM node:24-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends wireguard-tools libcap2-bin ca-certificates \
 && setcap cap_net_admin+ep /usr/bin/wg \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /repo/apps/connector/dist ./dist
ENV NODE_ENV=production
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HEALTHZ_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.js"]
