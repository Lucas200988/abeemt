# syntax=docker/dockerfile:1
# Build da API em múltiplos estágios: a imagem final não carrega toolchain.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# --- dependências ---------------------------------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/config/package.json ./packages/config/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/database/package.json ./packages/database/
COPY packages/logger/package.json ./packages/logger/
RUN pnpm install --frozen-lockfile

# --- build ----------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json turbo.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @bora/database exec prisma generate \
 && pnpm --filter @bora/config run build \
 && pnpm --filter @bora/logger run build \
 && pnpm --filter @bora/contracts run build \
 && pnpm --filter @bora/database run build \
 && pnpm --filter @bora/api run build

# --- runtime --------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/package.json ./package.json

# Não roda como root.
USER node
EXPOSE 3001

# O health check usa /health (liveness), não /ready: se o banco cair, reiniciar
# o container não resolve — só multiplicaria o problema.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/main.js"]
