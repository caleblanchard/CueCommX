# CueCommX

**Software-defined professional intercom for live production teams.**

CueCommX turns any phone, tablet, or laptop into a full-featured comms station. It runs entirely on your local network — no cloud accounts, no dedicated hardware, no per-seat fees. Plug in a Linux box, start the Docker container, and your whole crew is on comms in minutes.

---

## Features

- **Multi-channel talk** — dedicated channels (Production, Audio, Video/Camera, Lighting, Stage, …) with independent talk/listen control
- **IFB (Interrupted Foldback)** — private feeds with ducking for talent/director monitoring
- **Per-user channel ordering** — each user can reorder channels to suit their workflow
- **Admin panel** — browser-based interface to manage users, channels, and settings
- **Real-time chat** — per-channel text chat alongside audio
- **Push-to-talk and latching talk modes**
- **iOS Lock Screen controls** — Live Activity widget shows talk status and key channels without unlocking the phone
- **Local network discovery** — mDNS advertisement plus manual IP / QR-code connection
- **Optional HTTPS** — self-signed CA included for LAN deployments; see `certs/README.md`
- **Recordings** — capture channel audio server-side (admin only)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Linux host (Docker)                                        │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  @cuecommx/server  (Fastify + mediasoup SFU)         │  │
│  │  • HTTP/WebSocket API    • SQLite database           │  │
│  │  • WebRTC media routing  • Static file serving       │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
            │ LAN (wired or Wi-Fi)
  ┌─────────┼──────────┐
  ▼         ▼          ▼
Web app  iOS app  Android app
```

### Monorepo layout

```
apps/
  server/       Node.js 20 + TypeScript — Fastify, mediasoup, SQLite
  web-client/   React + Vite + Tailwind v4 — operator/crew web app
  admin-ui/     React + Vite — admin panel (served at /admin)
  mobile/       Expo prebuild + React Native — iOS & Android

packages/
  protocol/       Shared wire types, Zod schemas, API models
  core/           Shared client session/state logic
  design-tokens/  Semantic colors, spacing, typography, motion
```

---

## Getting started

### Production — Docker

The fastest path to a running system:

```bash
cp .env.example .env
# Edit .env — set CUECOMMX_ANNOUNCED_IP to your Linux host's LAN IP:
#   ip route get 1 | awk '{print $7; exit}'

docker compose up -d
```

Then open `http://<host-ip>:3000` to complete the setup wizard.

See **[DEPLOY.md](DEPLOY.md)** for the full guide including firewall rules, TLS/HTTPS setup, data backup, and troubleshooting.

### Development

**Prerequisites:** Node.js ≥ 20, npm ≥ 10

```bash
# Install all workspace dependencies
npm install

# Start everything in watch mode (server + web-client + admin-ui)
npm run dev
```

Individual workspaces:

```bash
# Server only (http://localhost:3000)
npm run dev --workspace @cuecommx/server

# Web client only (http://localhost:4173)
npm run dev --workspace @cuecommx/web-client

# Admin UI only (http://localhost:4174)
npm run dev --workspace @cuecommx/admin-ui
```

#### Mobile (iOS / Android)

Expo Go is **not supported** — WebRTC requires a custom native build.

```bash
# One-time native prebuild (re-run after adding native deps)
npx expo prebuild --workspace @cuecommx/mobile

# Run on a connected device or simulator
npm run ios      # or: npm run android
```

---

## Development server

The server reads its configuration from environment variables. For local dev, copy `.env.example` and point it at `localhost`:

```bash
cp .env.example .env
# CUECOMMX_ANNOUNCED_IP=127.0.0.1  (or your machine's LAN IP for device testing)
```

For HTTPS on device (required for iOS WebRTC on non-localhost origins), see `certs/README.md` — a pre-generated self-signed CA is included.

---

## Testing

```bash
# All unit/integration tests
npm test

# Watch mode
npm run test:watch

# Type-check all packages
npm run typecheck

# Web E2E (Playwright — requires a running server)
npm run test:e2e:web

# Mobile E2E
npm run test:e2e:mobile:ios
npm run test:e2e:mobile:android
```

Tests use **Vitest** for unit/integration, **Playwright** for web E2E, and **Detox** for mobile E2E.

---

## Configuration reference

Full variable reference is in [`.env.example`](.env.example). Key variables:

| Variable | Default | Required |
|---|---|---|
| `CUECOMMX_ANNOUNCED_IP` | — | **Yes** — LAN IP advertised to WebRTC clients |
| `CUECOMMX_SERVER_NAME` | `CueCommX` | No |
| `CUECOMMX_PORT` | `3000` | No |
| `CUECOMMX_RTC_MIN_PORT` | `40000` | No |
| `CUECOMMX_RTC_MAX_PORT` | `41000` | No |
| `CUECOMMX_TLS_CERT_FILE` | — | No — enables HTTPS when set with key |
| `CUECOMMX_TLS_KEY_FILE` | — | No — enables HTTPS when set with cert |

---

## Contributing

- Shared wire types belong in `packages/protocol` — do not duplicate protocol models in app packages.
- Keep browser-only APIs (Web Audio, etc.) behind boundaries so shared logic stays portable to React Native.
- Write failing tests first; implement the minimum code to pass; refactor with tests green.
- Changes must typecheck: `npm run typecheck`.

---

## License

MIT
