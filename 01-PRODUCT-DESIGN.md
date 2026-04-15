# CueCommX — Overall Product Design

## 1. Vision & Purpose

**CueCommX** is an open-source, software-based professional intercom system designed primarily for houses of worship, but applicable to any live production environment. It replaces expensive dedicated intercom hardware (Clear-Com, RTS, Unity Intercom, Green-GO) with a server application ("the brain") and client apps that run on devices people already own — iPhones, Android phones, and computers with web browsers.

### Core Principles

- **Zero dedicated hardware** — use existing phones, tablets, laptops
- **Fully local** — runs entirely on the local network (wired or WiFi); no cloud dependency
- **Low latency** — production-grade audio latency suitable for live cueing
- **Open source** — MIT licensed, community-driven
- **Simple deployment** — run the server on any Linux PC or in Docker
- **Test-driven development** — tests are written before implementation; all features require automated test coverage

### Target Users

- **Primary:** Houses of worship production teams (10–30 users)
- **Secondary:** Live events, theater, corporate AV, broadcast

### Competitive Landscape

| Product | Type | Price | Limitations CueCommX Addresses |
|---------|------|-------|-------------------------------|
| Unity Intercom | Software (Mac-only server) | $660+ base + per-user | Mac-only server, proprietary, expensive |
| Clear-Com Gen-IC | Cloud SaaS | Subscription | Cloud-dependent, not local, expensive |
| Clear-Com Agent-IC | Mobile app (requires hardware matrix) | Per-device license | Requires Eclipse HX hardware ($10K+) |
| Green-GO | Hardware intercom | $500+ per beltpack | Fully hardware-based, expensive at scale |
| **CueCommX** | **Open-source software** | **Free** | **Cross-platform, local, no cost** |

---

## 2. System Architecture

### 2.1 High-Level Overview

```
┌─────────────────────────────────────────────────────┐
│                   LOCAL NETWORK                      │
│                                                     │
│  ┌──────────────────────────────────────────────┐   │
│  │           CueCommX Server ("Brain")            │   │
│  │                                              │   │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────┐  │   │
│  │  │ Signaling│  │  Media   │  │  Admin    │  │   │
│  │  │  Server  │  │  Server  │  │  Web UI   │  │   │
│  │  │(WebSocket│  │  (SFU)   │  │ (HTTP)    │  │   │
│  │  └──────────┘  └──────────┘  └───────────┘  │   │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────┐  │   │
│  │  │  REST    │  │  mDNS    │  │  State    │  │   │
│  │  │  API     │  │ Discovery│  │  Manager  │  │   │
│  │  └──────────┘  └──────────┘  └───────────┘  │   │
│  └──────────────────────────────────────────────┘   │
│                        │                             │
│          ┌─────────────┼─────────────┐              │
│          │             │             │              │
│     ┌────▼────┐  ┌─────▼────┐  ┌────▼────┐        │
│     │   iOS   │  │ Android  │  │   Web   │        │
│     │  Client │  │  Client  │  │ Client  │        │
│     └─────────┘  └──────────┘  └─────────┘        │
└─────────────────────────────────────────────────────┘
```

### 2.2 Server Components

#### Media Server (SFU — Selective Forwarding Unit)

The heart of CueCommX audio. Uses **mediasoup** (high-performance WebRTC SFU with C++ worker and Node.js API) to:

- Receive audio streams from each connected client
- Selectively forward audio to other clients based on channel membership
- Route audio per channel subscriptions via consumer management
- Handle codec negotiation (Opus codec, 48kHz, mono, ptime=10ms)

**Why SFU over mesh or MCU:**
- **Mesh (P2P):** Doesn't scale past ~6 users; each client sends to every other client
- **MCU (mixing on server):** High CPU cost, adds latency from transcoding
- **SFU (selective forwarding):** Server forwards packets without transcoding; scales to 30+ users with low latency and moderate CPU

**Transport Model:** Each client creates **two** WebRTC transports — one for sending (producing audio) and one for receiving (consuming audio from others). This is a fundamental mediasoup requirement.

#### Signaling Server (WebSocket)

- Manages WebRTC session negotiation (SDP offers/answers, ICE candidates)
- Broadcasts real-time state changes (user online/offline, talk/listen status, call signals)
- Handles channel subscription changes
- Provides heartbeat/keepalive for presence detection

#### REST API

- CRUD operations for users, channels, groups
- Server configuration and status
- Authentication (local API keys or simple username/password)
- Used by both admin panel and client apps

#### Admin Web UI

- Web-based configuration panel served directly from the server
- User management, channel/group configuration
- Real-time system monitoring (connected users, audio levels, network stats)
- Built with React, bundled with the server

#### mDNS / Auto-Discovery

- Server broadcasts its presence on the local network via mDNS (Bonjour/Avahi)
- Clients can auto-discover the server without manual IP configuration
- Service type: `_cuecommx._tcp`

#### State Manager

- Maintains authoritative state of all channels, users, subscriptions, permissions
- Persists configuration to local SQLite database
- Broadcasts state changes to all connected clients in real-time

### 2.3 Client Architecture

All clients share the same core functionality:

```
┌──────────────────────────────────┐
│          CueCommX Client          │
│                                  │
│  ┌────────────┐  ┌────────────┐  │
│  │  WebRTC    │  │  WebSocket │  │
│  │  Audio     │  │  Signaling │  │
│  │  Engine    │  │  Client    │  │
│  └────────────┘  └────────────┘  │
│  ┌────────────┐  ┌────────────┐  │
│  │  Channel   │  │   Audio    │  │
│  │  Manager   │  │  Controls  │  │
│  └────────────┘  └────────────┘  │
│  ┌────────────────────────────┐  │
│  │        UI Layer            │  │
│  │  (Platform-specific)       │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

#### Platform Strategy

| Platform | Technology | Notes |
|----------|-----------|-------|
| **Web** | React + TypeScript | Native WebRTC API; works in Chrome, Firefox, Safari, Edge |
| **iOS** | Expo dev-client + React Native + react-native-webrtc | Single codebase shared with Android; Expo Go unsupported because native WebRTC code is required |
| **Android** | Expo dev-client + React Native + react-native-webrtc | Single codebase shared with iOS; prebuild/custom native workflow supported |

**Why React Native over Flutter:**
- WebRTC has mature, well-maintained React Native bindings
- Shared TypeScript knowledge between web and mobile teams
- React Native's bridge to native audio APIs is well-tested for real-time audio
- The web admin panel and web client are already React, maximizing code reuse

#### Shared Code

A `@cuecommx/core` TypeScript package will contain:
- WebRTC session management
- WebSocket signaling protocol
- Channel/group state management
- Audio level metering
- Protocol types and interfaces

This package is consumed by all three client platforms.

### 2.4 Network Architecture

```
Client A ──WebRTC──┐
                    │
Client B ──WebRTC──┤── mediasoup SFU ──┤── WebRTC── Client D
                    │                   │
Client C ──WebRTC──┘                   └── WebRTC── Client E
```

- All audio travels through the SFU (no peer-to-peer between clients)
- WebSocket used only for signaling and state — no audio over WebSocket
- Server should be on a wired connection for reliability
- Clients can be on WiFi or wired
- Expected latency: <50ms on a well-configured local network

### 2.5 Audio Architecture

#### Codec

- **Opus** codec at 48kHz, mono, 64kbps (configurable)
- Opus provides excellent quality at low bitency and has built-in FEC (Forward Error Correction)
- Native WebRTC codec — no transcoding needed

#### Channel Model

CueCommX uses a **party-line channel model** (industry standard):

- A **channel** is a named audio bus (e.g., "Production", "Camera", "Audio", "Stage")
- Multiple users can be assigned to a channel
- Each user has independent **Talk** and **Listen** controls per channel
- **Talk is all-or-nothing:** when a user activates Talk, their single audio producer is forwarded to ALL channels they have marked as "Talk active." This is how hardware belt packs work — your mic goes to all active talk channels simultaneously
- A user can Listen on multiple channels simultaneously
- Audio from all talkers on a channel is mixed and heard by all listeners

> **Design Decision (validated by architecture review):** The MVP uses a single-producer-per-user model where Talk activates/deactivates the producer globally. Per-channel independent talk (talking on Channel A but not Channel B simultaneously) requires multiple producers and is deferred to post-MVP. The single-producer model matches how most hardware intercom belt packs operate and is simpler to implement correctly.

#### Channel Mixing

The SFU forwards individual audio streams to each client. **Client-side mixing** is performed:
- Each client receives separate audio streams for each channel they're listening to
- The client mixes them locally with per-channel volume control
- This reduces server CPU and gives users individual volume control

#### Audio Modes

| Mode | Description | Use Case |
|------|------------|----------|
| **Push-to-Talk (PTT)** | User holds a button to transmit | Default mode; prevents open-mic noise |
| **Latch/Toggle** | User taps to toggle talk on/off | Hands-free operation |
| **VOX** | Voice-activated transmission | When hands are completely occupied |

> **Important:** All audio modes activate the user's single producer globally. When talking (via any mode), audio is sent to ALL channels the user has marked as "Talk active." This matches the hardware belt pack paradigm.

---

## 3. Technology Stack

### Server

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Runtime | **Node.js 20+ (LTS)** | Async I/O, large ecosystem, mediasoup bindings |
| Language | **TypeScript** | Type safety, shared with clients |
| SFU | **mediasoup v3** | Best-in-class open-source SFU; C++ workers for performance |
| HTTP/API | **Fastify** | High performance, schema validation, plugin ecosystem |
| WebSocket | **ws** (via Fastify plugin) | Lightweight, fast, well-tested |
| Database | **SQLite** (via better-sqlite3) | Zero-config, file-based, perfect for local appliance |
| Discovery | **bonjour-service** | mDNS/DNS-SD for auto-discovery |
| Process Mgmt | **PM2** or native systemd | Production process management |
| Containerization | **Docker** | Official Dockerfile and docker-compose |

### Clients

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Mobile | **Expo dev-client / prebuild + React Native** | Cross-platform iOS/Android with a managed developer experience that still permits required native modules |
| Mobile WebRTC | **react-native-webrtc** | Mature WebRTC bindings for React Native |
| Web | **React 19 + Vite** | Fast, modern web tooling |
| Web WebRTC | **Native browser APIs** | Built-in, no library needed |
| State Management | **Zustand** | Lightweight, TypeScript-first |
| Web UI Framework | **Tailwind CSS v4 + shadcn/ui + Radix UI** | Beautiful, accessible primitives with enough flexibility for an operator-grade control surface |
| Mobile UI Framework | **NativeWind v4** | Shared design-token vocabulary with web while preserving native rendering and performance |
| Motion & Feedback | **React Native Reanimated** (mobile), restrained CSS/Framer Motion (web) | Immediate press feedback and subtle state animation without gimmicks |

### Shared

| Component | Technology |
|-----------|-----------|
| Monorepo | **Turborepo** or **Nx** |
| Shared Package | `@cuecommx/core` (TypeScript) |
| Protocol | `@cuecommx/protocol` (shared types) |
| Design Tokens | `@cuecommx/design-tokens` | Shared semantic colors, spacing, radii, typography, elevation, and motion values |
| Build | **TypeScript 5.x**, **ESBuild** |
| Testing | **Vitest** (unit), **Playwright** (E2E web), **Detox** (E2E mobile) |

---

### UI/UX System

CueCommX should feel like a **premium production tool**: dark-first, calm, legible at a glance, and dependable under pressure.

**Framework choices:**
- **Web admin + web client:** Tailwind CSS v4 + shadcn/ui + Radix UI
- **Mobile client:** Expo dev-client / prebuild + NativeWind v4 + custom CueCommX mobile components, with React Native Reanimated for touch feedback and live-state motion
- **Shared design system:** `@cuecommx/design-tokens` package consumed by web and mobile

**Why this split works:**
- The admin dashboard benefits from a mature web component system (dialogs, tables, sheets, menus, forms)
- The live intercom surface is too specialized for a generic component library and should use bespoke controls for Talk, Listen, audio levels, and channel strips
- Tailwind + NativeWind keeps the design vocabulary aligned across platforms even when the components themselves are platform-specific
- Expo dev-client / prebuild keeps the React Native workflow maintainable while still allowing `react-native-webrtc`; Expo Go is intentionally out of scope

**UI/UX ground rules:**
1. **Dark-first, control-room aesthetic** — the main live-use surfaces default to a dark theme with high contrast and restrained accent colors.
2. **Talk controls are sacred** — Talk buttons are the largest and most stable controls; no layout shift or competing destructive actions nearby.
3. **Critical states are never ambiguous** — talking, listening, latched, force-muted, reconnecting, and disconnected states always use redundant cues (color + icon/label + motion/haptic/audio where appropriate).
4. **Color aids recognition, not comprehension** — channel colors speed scanning, but no critical meaning depends on color alone.
5. **Same mental model across platforms** — channel ordering, wording, iconography, and state semantics remain consistent between web and mobile.
6. **Platform-appropriate ergonomics** — web is keyboard-efficient with visible focus states; mobile is one-handed with minimum 60pt Talk targets.
7. **Motion is purposeful and subtle** — animation confirms a state change or highlights a live event; it is never decorative.
8. **Glanceability beats density** — the main comms view should be understandable in under a second during a live production moment.
9. **Accessibility is a release requirement** — web/admin targets WCAG AA contrast; UI states support assistive tech and scalable text.
10. **Design system first** — new UI is built from shared tokens and component primitives, not one-off styling.

---

## 4. Data Model

### Users

```typescript
interface User {
  id: string;              // UUID
  username: string;        // Display name (e.g., "Chuck - Camera Dir")
  role: Role;              // admin | operator | user
  pin?: string;            // Optional PIN for login
  channelPermissions: ChannelPermission[];
  settings: UserSettings;
}

type Role = 'admin' | 'operator' | 'user';
// admin: Full system configuration access
// operator: Force-mute, unlatch, All-Page, view all users (no user/channel CRUD)
// user: Basic talk/listen on assigned channels

interface ChannelPermission {
  channelId: string;
  canTalk: boolean;        // Permission to talk on this channel
  canListen: boolean;      // Permission to listen to this channel
}

interface UserSettings {
  defaultAudioMode: 'ptt' | 'latch' | 'vox';
  voxThreshold: number;    // dB threshold for VOX activation
  sidetone: boolean;       // Hear own voice in headset
  inputGain: number;       // Microphone gain
  outputVolume: number;    // Master output volume
}
```

### Channels

```typescript
interface Channel {
  id: string;              // UUID
  name: string;            // Display name (e.g., "Production")
  color: string;           // Hex color for UI identification
  priority: number;        // Higher priority channels duck lower ones
  type: 'partyline' | 'program' | 'direct';
}
```

### Groups

```typescript
interface Group {
  id: string;
  name: string;            // e.g., "Camera Crew", "Audio Team"
  channelIds: string[];    // Channels visible in this group
  userIds: string[];       // Users assigned to this group
}
```

### Real-Time State

```typescript
interface UserState {
  userId: string;
  online: boolean;
  connectedAt?: Date;
  talkingOn: string[];     // Channel IDs currently talking on
  listeningTo: string[];   // Channel IDs currently listening to
  audioLevel: number;      // Current mic input level (0-1)
  latency: number;         // Round-trip latency in ms
}
```

---

## 5. Signaling Protocol

All signaling uses WebSocket with JSON messages.

### Message Format

```typescript
interface SignalingMessage {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
  requestId?: string;      // For request/response correlation
}
```

### Key Message Types

| Direction | Type | Description |
|-----------|------|-------------|
| Client → Server | `auth` | Authenticate with username/PIN |
| Server → Client | `auth:result` | Authentication result + initial state |
| Client → Server | `talk:start` | Begin talking on channel(s) |
| Client → Server | `talk:stop` | Stop talking on channel(s) |
| Client → Server | `listen:start` | Begin listening to channel(s) |
| Client → Server | `listen:stop` | Stop listening to channel(s) |
| Server → Client | `user:state` | User state change broadcast |
| Client → Server | `call:signal` | Send call/alert signal to channel |
| Server → Client | `call:signal` | Receive call/alert signal |
| Client → Server | `webrtc:offer` | SDP offer for media negotiation |
| Server → Client | `webrtc:answer` | SDP answer from SFU |
| Both | `webrtc:ice` | ICE candidate exchange |
| Server → Client | `channel:update` | Channel config changed |
| Server → Client | `system:announce` | System-wide announcement |
| Client → Server | `ping` | Keepalive |
| Server → Client | `pong` | Keepalive response |

---

## 6. Security Model

Even though CueCommX runs on a local network, security is important:

- **Authentication:** Username + optional PIN (not passwords — this is a production tool, not a banking app)
- **Authorization:** Role-based (admin, operator, user) with per-channel permissions
- **Transport:** WebRTC audio is encrypted by default (DTLS-SRTP — mandatory in the WebRTC spec)
- **Signaling:** WebSocket over TLS (WSS) optional, plain WS default for local networks
- **Admin Panel:** Requires admin role authentication
- **No internet required:** System operates entirely within the local network

---

## 7. Deployment Model

### Option A: Direct Install (Linux)

```bash
# Install Node.js 20 LTS
# Clone or download CueCommX
npm install
npm run build
npm start
# Server available at http://<local-ip>:3000
```

### Option B: Docker (Recommended)

```yaml
# docker-compose.yml
version: '3.8'
services:
  cuecommx:
    image: cuecommx/server:latest
    ports:
      - "3000:3000"          # HTTP/WS/Admin
      - "40000-41000:40000-41000/udp"  # WebRTC media (RTP) — need ~4 ports per user
    environment:
      - CUECOMMX_SERVER_NAME=Main Church
      - CUECOMMX_MAX_USERS=30
    volumes:
      - cuecommx-data:/data   # Persistent config/database
    network_mode: host       # Required for mDNS and WebRTC (Linux only)
volumes:
  cuecommx-data:
```

> **Note:** `network_mode: host` only works correctly on Linux. Docker Desktop on macOS runs containers inside a Linux VM, so "host" networking refers to the VM, not the host machine. macOS Docker is acceptable for development but not production deployment.

### Supported Platforms (Server)

| Platform | Support Level | Notes |
|----------|--------------|-------|
| **Linux (native)** | **Primary** | Reference production platform; fully tested |
| **Linux (Docker)** | **Primary** | Recommended for easy deployment |
| **macOS** | Development only | Works for development; not a deployment target |

### System Requirements (Server)

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 cores | 4+ cores |
| RAM | 1 GB | 2+ GB |
| Network | 100 Mbps | 1 Gbps (wired) |
| OS | Ubuntu 20.04+ / Debian 11+ | Any modern Linux |
| Storage | 100 MB | 500 MB |

---

## 8. Repository Structure

```
cuecommx/
├── packages/
│   ├── server/              # Node.js server (brain)
│   │   ├── src/
│   │   │   ├── media/       # mediasoup SFU management
│   │   │   ├── signaling/   # WebSocket signaling
│   │   │   ├── api/         # REST API routes
│   │   │   ├── admin/       # Admin panel (built React app)
│   │   │   ├── discovery/   # mDNS service
│   │   │   ├── state/       # State management
│   │   │   ├── db/          # SQLite database layer
│   │   │   └── config/      # Server configuration
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── web-client/          # React web client
│   │   ├── src/
│   │   └── package.json
│   ├── mobile/              # React Native mobile app
│   │   ├── src/
│   │   ├── ios/
│   │   ├── android/
│   │   └── package.json
│   ├── admin-ui/            # React admin panel
│   │   ├── src/
│   │   └── package.json
│   ├── core/                # @cuecommx/core shared library
│   │   ├── src/
│   │   │   ├── webrtc/      # WebRTC session management
│   │   │   ├── signaling/   # WebSocket client
│   │   │   ├── audio/       # Audio utilities
│   │   │   ├── channels/    # Channel state management
│   │   │   └── types/       # Shared TypeScript types
│   │   └── package.json
│   └── protocol/            # @cuecommx/protocol shared types
│       ├── src/
│       └── package.json
├── docker-compose.yml
├── turbo.json               # Turborepo config
├── package.json              # Root workspace
├── LICENSE                   # MIT
└── README.md
```

---

## 9. Complete Feature List (All Phases)

### Audio & Communication
1. Party-line channels (named audio buses)
2. Push-to-Talk (PTT)
3. Latch/toggle talk mode
4. VOX (voice-activated) mode
5. Per-channel Talk/Listen controls
6. Per-channel volume control
7. Master volume control
8. All-Page (broadcast to all channels simultaneously)
9. Private/direct user-to-user communication
10. Program audio feeds (listen-only monitoring)
11. Audio ducking (lower other channels when priority channel is active)
12. Sidetone (hear own voice in headset)
13. Audio input/output device selection
14. Noise gate / noise suppression
15. Automatic gain control (AGC)
16. Audio level metering (visual VU meters)
17. Configurable Opus bitrate/quality

### User Management
18. User creation/editing/deletion
19. Role-based permissions (admin, operator, user)
20. Per-channel talk/listen permissions
21. PIN-based authentication
22. User profiles with saved preferences
23. User presence (online/offline status)
24. Admin force-mute / unlatch all

### Channels & Groups
25. Channel creation/editing/deletion with color coding
26. Groups (collections of channels presented together)
27. Global/sticky channels (persist across group switches)
28. Channel priority levels
29. Dynamic channel assignment

### Signaling & Alerts
30. Visual call signaling (flash/pulse indicators)
31. Audible call tones
32. System-wide announcements
33. Text chat messaging per channel
34. Urgent/priority alerts

### Server & Admin
35. Web-based admin panel
36. Real-time system monitoring dashboard
37. mDNS auto-discovery
38. SQLite configuration persistence
39. Server configuration via environment variables
40. System health monitoring (CPU, memory, network)
41. Connected user dashboard
42. Audio routing matrix visualization

### Deployment & Operations
43. Docker support with docker-compose
44. Linux native installation
45. Automatic server startup (systemd)
46. Configuration backup/restore
47. Logging and diagnostics

### Integrations (Future)
49. Tally integration (video switcher — ATEM, Ross, etc.)
50. GPIO triggers (hardware I/O)
51. Dante/AES67 audio bridge
52. External intercom bridging (Clear-Com, RTS 4-wire)
53. StreamDeck / X-Keys panel integration
54. OSC (Open Sound Control) protocol support
55. MIDI control surface support

### Advanced Features (Future)
56. AES-256 audio encryption
57. Multi-server redundancy / failover
58. Audio recording / logging
59. Bandwidth adaptation (quality adjustment based on network)
60. Custom notification sounds per channel
61. Haptic feedback patterns (mobile)
62. Landscape/portrait mode support (mobile)
63. Widget / lock-screen controls (mobile)
64. Split-ear audio (different channels in left/right ear)
65. Ambient listening mode (pass-through environmental audio)
66. Multi-language UI support

---

## 10. Quality Attributes

| Attribute | Target |
|-----------|--------|
| **Latency** | <50ms glass-to-glass on LAN (Opus ptime=10ms + ~10-20ms jitter buffer + ~2ms network + ~5ms processing) |
| **Capacity** | 30 simultaneous users, 16 channels |
| **Reliability** | Automatic reconnection with exponential backoff + jitter on network interruption |
| **Availability** | Server process auto-restart on crash; mediasoup worker crash recovery |
| **Usability** | New user operational within 60 seconds (via QR code scan) |
| **Glanceability** | Talk/listen/connection state understandable in under 1 second from the main comms screen |
| **Accessibility** | Web/admin meet WCAG AA contrast; no critical state relies on color alone; mobile live controls use 60pt+ primary touch targets |
| **Audio Quality** | Opus 48kHz mono, clear intelligible speech |
| **CPU (server)** | <50% on 4-core machine with 30 users |
| **Bandwidth** | ~100 kbps per user per channel (with DTX, near-zero during silence) |

> **⚠ Bluetooth Warning:** Bluetooth headsets (AirPods, etc.) switch from A2DP (high-quality stereo) to HFP/SCO (mono 8-16kHz) when WebRTC microphone is active. This significantly degrades audio quality. **Wired headsets are strongly recommended** for production-critical roles. Document this prominently in user-facing materials.
