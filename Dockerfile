# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN npm ci

RUN npm run build --workspace @cuecommx/protocol \
  && npm run build --workspace @cuecommx/core \
  && npm run build --workspace @cuecommx/design-tokens \
  && npm run build --workspace @cuecommx/server \
  && npm run build --workspace @cuecommx/admin-ui \
  && npm run build --workspace @cuecommx/web-client

FROM node:20-bookworm-slim AS production-deps

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/admin-ui/package.json ./apps/admin-ui/package.json
COPY apps/web-client/package.json ./apps/web-client/package.json
COPY apps/mobile/package.json ./apps/mobile/package.json
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/design-tokens/package.json ./packages/design-tokens/package.json

RUN npm ci --omit=dev --workspace @cuecommx/server --workspace @cuecommx/protocol --include-workspace-root=false \
  && npm cache clean --force

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    CUECOMMX_DATA_DIR=/var/lib/cuecommx/data \
    CUECOMMX_HOST=0.0.0.0 \
    CUECOMMX_PORT=3000 \
    CUECOMMX_RTC_MIN_PORT=40000 \
    CUECOMMX_RTC_MAX_PORT=41000

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/admin-ui/package.json ./apps/admin-ui/package.json
COPY apps/web-client/package.json ./apps/web-client/package.json
COPY apps/mobile/package.json ./apps/mobile/package.json
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/design-tokens/package.json ./packages/design-tokens/package.json
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=production-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/admin-ui/dist ./apps/admin-ui/dist
COPY --from=build /app/apps/web-client/dist ./apps/web-client/dist
COPY --from=build /app/packages/protocol/dist ./packages/protocol/dist

RUN mkdir -p /var/lib/cuecommx/data \
  && chown -R node:node /app /var/lib/cuecommx

VOLUME ["/var/lib/cuecommx/data"]

EXPOSE 3000/tcp

# CueCommX media uses the configured RTP range on the host-network deployment.
# Keep `CUECOMMX_RTC_MIN_PORT` / `CUECOMMX_RTC_MAX_PORT` aligned with the Linux host firewall.

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.CUECOMMX_PORT || '3000') + '/api/status').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

USER node

CMD ["node", "apps/server/dist/index.js"]
