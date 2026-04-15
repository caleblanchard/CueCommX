# CueCommX repository instructions

## Product context

- CueCommX is a **local-network, software-only professional intercom system** for live production teams, especially houses of worship.
- The MVP target is **10-30 concurrent users** on a **Linux-hosted** server with **Docker** support.
- Clients are:
  - web app
  - iOS app
  - Android app
- The system is **fully local**. Do not introduce cloud dependencies, SaaS requirements, or WAN-first assumptions.

## Architecture guardrails

- Server stack:
  - Node.js 20+
  - TypeScript
  - Fastify for HTTP/API
  - WebSocket signaling
  - SQLite via `better-sqlite3`
  - mediasoup for WebRTC SFU
- Web/admin stack:
  - React + TypeScript
  - Vite
  - Tailwind CSS v4
  - shadcn/ui + Radix UI
- Mobile stack:
  - Expo dev-client / prebuild + React Native + TypeScript
  - `react-native-webrtc`
  - NativeWind v4
  - React Native Reanimated
  - Expo Go is intentionally unsupported because WebRTC requires custom native code
- Shared packages:
  - `@cuecommx/protocol` for wire types, validation, and API/shared models
  - `@cuecommx/core` for shared client/session/state logic
  - `@cuecommx/design-tokens` for semantic colors, spacing, typography, radii, elevation, and motion

## MVP audio rules

- Preserve the approved **single-producer-per-user** model for MVP.
- When a user is talking, their single producer is routed to **all channels marked as active for talk**.
- mediasoup integration must use **two WebRTC transports per client**:
  - one send transport
  - one receive transport
- Use Opus with:
  - 48kHz
  - mono
  - `ptime=10`
- Keep client-side mixing responsibilities separate from server routing responsibilities.

## TDD expectations

- CueCommX uses **test-driven development**.
- For each feature:
  1. write failing tests first
  2. implement the minimum code to pass
  3. refactor with tests still green
- Prefer:
  - Vitest for unit/integration tests
  - Playwright for web E2E
  - Detox for mobile E2E
- High-risk logic that must be covered early:
  - protocol validation
  - server config loading
  - database bootstrap/migrations
  - routing and permission logic
  - reconnection/backoff behavior

## Platform constraints

- **Linux and Docker only** for the server target.
- Do not add Windows-specific behavior, docs, scripts, or assumptions.
- Keep QR/manual connection flows as first-class UX.
- Treat mDNS as best-effort, not the only discovery mechanism.

## UI/UX guardrails

- CueCommX is a production tool: prioritize calm, dark-first, high-contrast interfaces over decorative UI.
- Talk controls are the highest-priority interaction and must remain large, stable, and unmistakable.
- Critical states must never rely on color alone; use redundant cues like labels, icons, motion, and haptics where available.
- Keep the mental model consistent across web and mobile: same terms, channel ordering, and state semantics.
- Web should be keyboard-efficient with visible focus states; mobile should be one-handed and use 60pt+ primary Talk targets.
- Prefer shared design tokens and reusable primitives over one-off styles.

## Repository conventions

- Keep shared types in `@cuecommx/protocol`; do not duplicate protocol models in app packages.
- Keep browser-only APIs, especially Web Audio APIs, behind boundaries so shared logic remains portable to React Native.
- Use `CUECOMMX_` prefixes for environment variables.
- Default house-of-worship channels are:
  - Production
  - Audio
  - Video/Camera
  - Lighting
  - Stage
- Prefer explicit error handling over silent fallbacks.
- Keep changes small, typed, and composable.
