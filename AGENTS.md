# CueCommX agent guide

## First principles

- CueCommX is LAN-only. Do not add cloud dependencies, SaaS assumptions, or WAN-first workflows.
- Server target is Linux + Docker. Do not add Windows-specific server behavior or docs.
- Use the domain terms from `CONTEXT.md`: **Operator session**, **Operator-session coordination**, **Channel chat**. Avoid using vague "realtime" when one of those terms is more accurate.

## Toolchain and workspace facts

- Use Node 20+ and `npm@10.8.2`.
- This repo is an npm workspaces monorepo (`apps/*`, `packages/*`) orchestrated by Turbo.
- Keep `turbo run ...` commands at the repo root only; workspace `package.json` scripts should stay plain and not recursively call Turbo.
- There is no checked-in CI workflow or pre-commit hook config. If you change code, run verification yourself.

## Commands that matter

- Install deps: `npm install`
- Start all dev services: `npm run dev`
- Start one workspace:
  - server: `npm run dev --workspace @cuecommx/server`
  - web: `npm run dev --workspace @cuecommx/web-client`
  - admin: `npm run dev --workspace @cuecommx/admin-ui`
- Typecheck everything: `npm run typecheck`
- Run all tests: `npm test`
- Run web E2E: `npm run test:e2e:web`
- Install Playwright browser for web E2E: `npm run test:e2e:web:install`
- Mobile native prebuild: `npx expo prebuild --workspace @cuecommx/mobile`
- Run mobile app: `npm run ios` / `npm run android`

## Verification gotchas

- Root `npm test` is not test-only: Turbo makes `test` depend on `build`.
- Prefer workspace-scoped verification while iterating; use root commands when you need cross-workspace coverage.
- Server distributable validation should use `npm run build --workspace @cuecommx/server`, not just `tsc`, because the build also copies `src/db/schema.sql` into `dist/db/schema.sql`.
- Playwright config starts only the web-client Vite server on `127.0.0.1:4173`; it does not start the Fastify backend for you.
- After native dependency or config-plugin changes in mobile, rerun `npx expo prebuild --clean --workspace @cuecommx/mobile` before `npm run ios` / `npm run android`.

## Architecture map

- `apps/server/src/index.ts`: server entrypoint.
- `apps/server/src/app.ts`: main wiring point; composes DB, Operator-session coordination transport, mediasoup, mDNS, OSC, GPIO, recording, tally, API routes, and static asset serving.
- `apps/server/src/config.ts`: authoritative `CUECOMMX_*` env parsing/validation.
- `apps/server/src/realtime/service.ts`: transport layer that hosts both Operator-session coordination and Channel chat on the same WebSocket surface.
- `apps/server/src/media/service.ts`: mediasoup worker/router lifecycle and transport/producer/consumer wiring.
- `apps/web-client/src/App.tsx`: monolithic web operator app entry.
- `apps/mobile/App.tsx`: monolithic mobile operator app entry.
- `apps/admin-ui/src/`: separate admin app served at `/admin` when built.
- `packages/protocol`: shared wire types and validation. Put protocol shape changes here.
- `packages/core`: shared client/session logic for web and mobile.

## Product and implementation guardrails

- Keep the approved MVP audio model: one producer per user, routed to all channels active for talk.
- mediasoup uses two WebRTC transports per client: one send, one receive.
- Keep client-side mixing concerns separate from server routing concerns.
- Shared wire types belong in `@cuecommx/protocol`; do not duplicate protocol models in app packages.
- Keep browser-only APIs behind boundaries so shared logic remains portable to React Native.
- Expo Go is intentionally unsupported; mobile work depends on Expo prebuild/dev-client and local native modules under `apps/mobile/modules/*`.
- UI is a production tool: prioritize stable, high-contrast, keyboard-efficient controls on web and large, obvious talk targets on mobile.

## Deployment facts agents often miss

- Fastest production path:
  1. `cp .env.example .env`
  2. set `CUECOMMX_ANNOUNCED_IP` to the Linux host LAN IP
  3. `docker compose up -d`
- Docker deployment uses `network_mode: host`. Do not switch to bridge networking casually; mediasoup/NAT behavior depends on this setup.
- Open TCP 3000 and UDP 40000-41000 on the host firewall.
- iOS clients require HTTPS for WebRTC on non-localhost origins. Local cert guidance lives in `certs/README.md`.
- `CUECOMMX_ANNOUNCED_IP` is operationally required for real LAN WebRTC deployments even though code defaults allow it to be omitted.
- Persistent server data lives in the `cuecommx-data` Docker volume at `/var/lib/cuecommx/data`.

## Generated or easy-to-miss artifacts

- `apps/web-client/src/third-party-notices.json` and `apps/mobile/third-party-notices.json` are generated files.
- Regenerate third-party notices after dependency changes with `npx --yes license-checker --production --json --excludePrivatePackages`, then deduplicate by package name and copy results to both locations.

## Testing expectations

- Follow TDD when adding or changing behavior: failing test first, minimum fix, then refactor.
- Prefer Vitest for unit/integration, Playwright for web E2E, Detox for mobile E2E.
- High-risk areas that should not ship untested: protocol validation, config loading, DB bootstrap, routing/permissions, reconnection behavior.
