# CueCommX — MVP Design & Implementation Guide

## 1. MVP Scope Definition

The MVP delivers a **functional party-line intercom system** that a house of worship production team can use during a live service. It must be reliable enough for real-world use on day one, even if it lacks advanced features.

### MVP Success Criteria

A production team of 10–15 people can:
1. Start the CueCommX server on a local PC or in Docker
2. Open the web app or install the mobile app on their personal devices
3. Connect to the server automatically (or by entering the server IP)
4. Be assigned to channels by an admin
5. Talk and listen on their assigned channels with low latency
6. Control their talk/listen state and volume during a live service
7. See who is online and who is currently talking

### What the MVP is NOT

- Not a replacement for a full Clear-Com/RTS matrix system
- Not designed for internet/WAN use (local network only)
- Not a recording system
- Not integrated with video switchers or other hardware

### Current implementation status (updated)

The checklist below reflects the current repository state, not just the aspirational MVP scope.

**Implemented in the repo today**
- Monorepo foundation with Turbo, TypeScript, Vitest, shared protocol/core packages, and shared design tokens
- Linux/Docker-oriented Fastify + SQLite server foundation with seeded channels, migrations, config loading, and status/channels endpoints
- First-admin bootstrap, username/PIN login, in-memory session issuance, and admin bearer-token auth guards
- Case-insensitive username handling for admin/operator login and duplicate prevention while preserving stored display casing
- Realtime WebSocket signaling with protocol-version-aware session auth, presence, operator-state updates, and reconnect-capable shared client logic
- mediasoup-backed media runtime with requestId-correlated capabilities/transport/producer/consumer signaling, worker restart handling, and permission-aware channel routing
- Web admin setup/login plus user and channel roster management (create, edit, delete, role assignment, channel permission assignment)
- Live admin monitoring with real-time online/offline updates, active channel talker indicators, and per-user force-mute controls
- Discovery handoff with a shared `/api/discovery` contract, admin QR/manual connect surfaces, detected network-interface visibility, active mDNS status, and a web-client manual server handoff flow
- Web operator surface with authenticated listen/PTT controls, real browser audio negotiation, latch mode, live mic metering, device selection, per-channel volume trim, master monitor volume, and remote talker indicators
- Expo dev-client / prebuild mobile client with NativeWind, Reanimated, `react-native-webrtc` + mediasoup wiring, manual server handoff, operator login, arm-audio flow, live listen/talk state, mic metering, monitor volume controls, and keep-awake/background-audio configuration
- mediasoup transport advertisement now auto-detects a reachable LAN IP when `CUECOMMX_ANNOUNCED_IP` is unset, avoiding `0.0.0.0` ICE candidates during local mobile audio startup
- Production packaging with server-hosted web/admin bundles, optional HTTPS/WSS via local TLS cert/key files, a multi-stage Dockerfile, Linux host-network Compose deployment, compiled server runtime assets copied into `dist`, and daemon-validated container startup/health/asset serving

**Still required before the MVP is complete**
- Real multi-user/load signoff for the documented 30-user target (code-level max-user admission control is implemented; hardware/network verification remains manual)
- Native Android foreground-service-backed persistent audio remains a device/native follow-up beyond the current notification-backed background-audio hardening
- Manual device/load signoff for the open checklist items in Section 7 (physical mobile audio validation and multi-user latency verification)

> When an item is broader than what is currently implemented, it stays unchecked even if a narrower foundation slice already exists.

---

## 2. MVP Feature Set

### 2.1 Server ("Brain")

#### Media Server
- [x] mediasoup SFU integration for WebRTC audio
- [x] Opus at 48kHz with intercom-oriented browser codec options (`opusFec`, `opusDtx`, `opusPtime=10`); router codec remains on the mediasoup-supported baseline shape
- [ ] Support for up to 30 simultaneous audio streams (code-level capacity enforcement is in place; real load validation remains manual signoff)
- [x] **Two WebRTC transports per client** (one send, one receive — mediasoup requirement)
- [x] Per-channel audio routing (selective forwarding based on channel membership)
- [x] Single-producer-per-user model: talk activates producer for ALL active talk channels
- [x] Local-network ICE negotiation without TURN
- [x] mediasoup worker crash recovery (worker `died` handling, router re-init, client disconnect/reconnect path)

#### Signaling Server
- [x] WebSocket server for real-time signaling
- [x] mediasoup request/response negotiation with mandatory requestId correlation (capabilities, transports, producers, consumers)
- [x] User state broadcasting (online/offline, talking/listening)
- [x] Heartbeat/keepalive with automatic disconnect detection
- [x] Protocol version negotiation (`protocolVersion` in auth response; reject mismatched clients gracefully)
- [x] Transport/consumer resource cleanup on client disconnect

#### REST API
- [x] `POST /api/auth/setup-admin` — bootstrap the first admin account
- [x] `POST /api/auth/login` — authenticate with username + optional PIN
- [x] `GET /api/users` — list all users (admin only)
- [x] `POST /api/users` — create user (admin only)
- [x] `PUT /api/users/:id` — update user (admin only)
- [x] `DELETE /api/users/:id` — delete user (admin only)
- [x] `GET /api/channels` — list all channels
- [x] `POST /api/channels` — create channel (admin only)
- [x] `PUT /api/channels/:id` — update channel (admin only)
- [x] `DELETE /api/channels/:id` — delete channel (admin only)
- [x] `GET /api/status` — server health and connected user count
- [x] `GET /api/discovery` — primary and alternate local connect targets

#### Discovery
- [x] QR code displayed on admin dashboard encoding the primary LAN HTTP URL for client connection
- [x] Manual server URL handoff on the web client (fallback)
- [x] mDNS broadcast (`_cuecommx._tcp`) for auto-discovery on LAN (best-effort; may fail on some networks)

#### Persistence
- [x] SQLite database for user accounts, channels, permissions
- [x] Database stored in configurable data directory
- [x] Auto-migration on server startup

#### Configuration
- [x] Environment variable configuration (`CUECOMMX_PORT`, `CUECOMMX_SERVER_NAME`, etc.)
- [x] Sensible defaults for zero-config startup

### 2.2 Web Admin Panel

A React-based admin interface served from the server at `http://<server>:3000/admin`.

#### Dashboard
- [x] Connected users list with online/offline status
- [x] Active channels with current talker indicators
- [x] Server health metrics (uptime, connected clients)
- [x] **QR code** prominently displayed for client connection (encodes server URL)
- [x] **Server URL** displayed prominently for manual connection
- [x] **Force-mute button** next to each connected user (admin emergency control for open mics)

#### User Management
- [x] Create new users with display name and optional PIN
- [x] Assign role: admin, operator, or user
- [x] Assign channel permissions (which channels a user can talk/listen on)
- [x] Edit existing users
- [x] Delete users
- [x] View user online/offline status in real-time

#### Channel Management
- [x] Create channels with name and color
- [x] Edit channel name/color
- [x] Delete channels
- [x] View active talkers per channel

#### Initial Setup
- [x] First-run detection: if no admin user exists, prompt to create one
- [x] Default channels pre-populated for HoW: "Production", "Audio", "Video/Camera", "Lighting", "Stage"
- [x] Network interface display on first run (show all detected IPs, highlight the primary discovery target, and surface `CUECOMMX_ANNOUNCED_IP` override guidance)

> **Note:** A polished first-run wizard is deferred to post-MVP. For MVP, the admin creates users and channels through the regular admin panel interface.

### 2.3 Web Client

A React-based intercom client at `http://<server>:3000`.

#### Login
- [x] Username entry/selection for configured users (current implementation uses manual username entry)
- [x] Optional PIN entry
- [x] Discovery via admin-shared LAN URL/QR handoff (browser-native mDNS scanning remains out of scope for MVP)
- [x] Manual server URL/IP fallback

#### Main Interface
- [x] Assigned channel control surface (current implementation is a functional card layout; final strip layout is still pending)
- [x] Per-channel **Talk** button (momentary push-to-talk by default)
- [x] Per-channel **Latch/Toggle** talk mode
- [x] Per-channel **Listen** toggle button
- [x] Per-channel volume slider
- [x] Visual indicator: channel color bar
- [x] Visual indicator: remote and local active talk state badges
- [x] Visual indicator: all active talk channels illuminate when any talk is active (single-producer model)
- [x] Master volume control
- [x] Audio level meter for own microphone input
- [x] "Tap to activate audio" entry point on first use (implemented as a dedicated arm-audio card/button rather than a blocking overlay)

#### Status Bar
- [x] Connection status indicator (connected/reconnecting/disconnected)
- [x] Server name display
- [x] Own username display
- [x] Latency indicator

#### Audio Controls
- [x] Microphone permission request handling
- [x] Audio input device selection (if multiple available)
- [x] WebRTC audio constraints: `echoCancellation: true`, `noiseSuppression: true`, `autoGainControl: true`

> **Note:** Audio output device selection (`setSinkId`) is deferred to post-MVP due to inconsistent browser support (Chrome only; not supported in Firefox or Safari).

#### Reconnection
- [x] Automatic reconnection on WebSocket disconnect with **exponential backoff + jitter** (prevents reconnection storm when server restarts)
- [x] Re-establish WebRTC media on reconnection
- [x] Restore previous listen/volume state from localStorage on reconnect
- [x] Visual indication during reconnection

### 2.4 iOS Client (React Native)

> **Current repo status:** Expo dev-client / prebuild foundation, NativeWind, Reanimated, `react-native-webrtc` + mediasoup integration scaffolding, manual server handoff, operator login, arm-audio flow, live listen/talk state, mic metering, monitor volume controls, wake lock, Expo AV audio-session configuration, RTCAudioSession activation/deactivation hooks, Talk/Latch haptics, and Android live-audio notification/battery guidance are in place. Automatic mDNS discovery remains deferred beyond MVP.

#### Login
- [x] Manual server IP entry / admin-shared LAN URL handoff
- [x] Username selection + optional PIN

#### Main Interface
- [x] Session readiness shell with connection state, assigned channels, and live permission summary
- [x] Channel strip/card layout (scrollable if many channels)
- [x] Per-channel **Talk** button — large, touch-friendly (minimum 60pt tap target)
- [x] Per-channel **Listen** toggle
- [x] Per-channel volume slider
- [x] Channel color indicators
- [x] Talking indicators (visual state badge + active Talk button styling)
- [x] Master volume control
- [x] Own mic level meter

#### Platform Integration
- [x] Background audio mode (keeps audio running when app is backgrounded)
- [x] Screen wake lock (prevent screen from sleeping during active use)
- [x] Microphone permission handling (iOS permission flow)
- [x] Explicit audio-session configuration for live comms (`expo-av` audio mode + `RTCAudioSession` activation hook)

#### Reconnection
- [x] Auto-reconnect on network change (WiFi roaming, etc.)
- [x] Graceful handling of app background/foreground transitions

### 2.5 Android Client (React Native)

Same feature set as iOS, plus:
- [x] Android-specific permission handling (microphone, foreground-service, wake-lock, notification)
- [ ] Background service for persistent audio
- [x] Battery optimization exemption prompt

### 2.6 UI/UX Requirements

CueCommX is production software, not a generic business app. The MVP must feel calm, premium, and trustworthy under pressure.

**Framework choices:**
- **Web admin + web client:** Tailwind CSS v4 + shadcn/ui + Radix UI
- **Mobile client:** Expo dev-client / prebuild + NativeWind v4 + custom CueCommX intercom components + React Native Reanimated
- **Shared design system:** `@cuecommx/design-tokens`

**MVP UI/UX ground rules:**
- [x] Default to a dark, high-contrast control-room theme for all live-use surfaces
- [x] Keep Talk controls visually dominant, stable in position, and impossible to confuse with secondary actions
- [x] Represent critical states with redundant cues (color + text/icon + motion/haptic where available)
- [x] Never rely on color alone for channel or status meaning
- [x] Keep the mental model consistent across web and mobile: same channel order, same labels, same state semantics
- [x] Make the web client keyboard-friendly (PTT shortcut, visible focus, fast tab order)
- [x] Make the mobile client one-handed and touch-safe (60pt+ Talk targets, no hidden critical actions)
- [x] Separate destructive admin actions (force-mute, delete) from routine configuration controls
- [x] Use motion only to confirm state changes or surface live events; avoid decorative animation during active use

---

## 3. Technical Implementation Details

### 3.1 Project Setup

```bash
# Initialize monorepo
npx create-turbo@latest cuecommx
cd cuecommx

# Package structure
apps/
  server/         # Node.js server
  admin-ui/       # React admin panel
  web-client/     # React web client
  mobile/         # Expo dev-client React Native app (iOS + Android)
packages/
  protocol/       # Shared TypeScript types & interfaces
  core/           # Shared WebRTC/signaling logic
  design-tokens/  # Shared semantic design tokens for web and mobile
```

#### Monorepo Configuration

```json
// turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": ["coverage/**"]
    },
    "test:watch": {
      "cache": false,
      "persistent": true
    }
  }
}
```

### 3.2 Protocol Package (`@cuecommx/protocol`)

Define all shared types used by server and clients:

```typescript
// packages/protocol/src/messages.ts

// === Authentication ===
export interface AuthRequest {
  type: 'auth';
  payload: {
    username: string;
    pin?: string;
  };
}

export interface AuthResponse {
  type: 'auth:result';
  payload: {
    success: boolean;
    user?: UserInfo;
    channels?: ChannelInfo[];
    error?: string;
  };
}

// === Channel Control ===
export interface TalkStartMessage {
  type: 'talk:start';
  payload: { channelIds: string[] };
}

export interface TalkStopMessage {
  type: 'talk:stop';
  payload: { channelIds: string[] };
}

export interface ListenToggleMessage {
  type: 'listen:toggle';
  payload: { channelId: string; listening: boolean };
}

// === WebRTC Signaling ===
export interface WebRTCOfferMessage {
  type: 'webrtc:offer';
  payload: { sdp: string };
}

export interface WebRTCAnswerMessage {
  type: 'webrtc:answer';
  payload: { sdp: string };
}

export interface WebRTCIceCandidateMessage {
  type: 'webrtc:ice';
  payload: { candidate: RTCIceCandidateInit };
}

// === State Broadcasts ===
export interface UserStateUpdate {
  type: 'user:state';
  payload: {
    userId: string;
    online: boolean;
    talkingOn: string[];
    listeningTo: string[];
    audioLevel: number;
  };
}

export interface ChannelStateUpdate {
  type: 'channel:update';
  payload: {
    channelId: string;
    activeTalkers: string[];
  };
}

// === Types ===
export type SignalingMessage =
  | AuthRequest | AuthResponse
  | TalkStartMessage | TalkStopMessage
  | ListenToggleMessage
  | WebRTCOfferMessage | WebRTCAnswerMessage | WebRTCIceCandidateMessage
  | UserStateUpdate | ChannelStateUpdate;
```

```typescript
// packages/protocol/src/models.ts

export type UserRole = 'admin' | 'user';

export interface UserInfo {
  id: string;
  username: string;
  role: UserRole;
  channelPermissions: ChannelPermission[];
}

export interface ChannelPermission {
  channelId: string;
  canTalk: boolean;
  canListen: boolean;
}

export interface ChannelInfo {
  id: string;
  name: string;
  color: string;  // Hex color code
}

export interface GroupInfo {
  id: string;
  name: string;
  channelIds: string[];
}

export interface ServerStatus {
  name: string;
  version: string;
  uptime: number;
  connectedUsers: number;
  maxUsers: number;
  channels: number;
}
```

### 3.3 Core Package (`@cuecommx/core`)

Shared WebRTC and signaling logic consumed by web and mobile clients.

```typescript
// packages/core/src/CueCommXClient.ts

export class CueCommXClient extends EventEmitter {
  private ws: WebSocket;
  private pc: RTCPeerConnection;
  private localStream: MediaStream;
  private channelStates: Map<string, ChannelState>;

  constructor(config: ClientConfig) { /* ... */ }

  // Connection
  async connect(serverUrl: string): Promise<void>;
  async disconnect(): Promise<void>;
  async reconnect(): Promise<void>;

  // Authentication
  async authenticate(username: string, pin?: string): Promise<AuthResult>;

  // Channel Control
  startTalk(channelIds: string[]): void;
  stopTalk(channelIds: string[]): void;
  toggleListen(channelId: string, listen: boolean): void;
  setChannelVolume(channelId: string, volume: number): void;
  setMasterVolume(volume: number): void;

  // Audio
  async requestMicrophoneAccess(): Promise<MediaStream>;
  setAudioInputDevice(deviceId: string): Promise<void>;
  setAudioOutputDevice(deviceId: string): Promise<void>;
  getInputLevel(): number;

  // State
  getChannelState(channelId: string): ChannelState;
  getConnectedUsers(): UserState[];
  isConnected(): boolean;

  // Events
  on(event: 'connected', handler: () => void): this;
  on(event: 'disconnected', handler: (reason: string) => void): this;
  on(event: 'user:state', handler: (state: UserStateUpdate) => void): this;
  on(event: 'channel:update', handler: (update: ChannelStateUpdate) => void): this;
  on(event: 'error', handler: (error: Error) => void): this;
}
```

### 3.4 Server Implementation

#### mediasoup SFU Setup

```typescript
// packages/server/src/media/MediaServer.ts

import * as mediasoup from 'mediasoup';

export class MediaServer {
  private worker: mediasoup.Worker;
  private router: mediasoup.Router;

  async initialize(): Promise<void> {
    // Create a single mediasoup worker
    // (one worker can handle 30+ audio-only users comfortably;
    //  add multi-worker load balancing post-MVP if needed)
    this.worker = await mediasoup.createWorker({
      rtcMinPort: 40000,
      rtcMaxPort: 41000,
      logLevel: 'warn',
    });

    // Handle worker crash — respawn and notify clients
    this.worker.on('died', () => {
      console.error('mediasoup worker died, restarting...');
      this.initialize(); // Re-create worker and router
      // TODO: notify all connected clients to reconnect
    });

    // Create router with Opus codec optimized for low-latency speech
    this.router = await this.worker.createRouter({
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 1,  // Mono — intercom is speech, not music
          parameters: {
            'ptime': 10,          // 10ms frames for low latency
            'minptime': 10,
            'useinbandfec': 1,    // FEC for packet loss recovery
            'usedtx': 1,          // Silence suppression (saves bandwidth)
          },
        },
      ],
    });
  }

  // Create SEND transport for a client (for their producer/microphone)
  async createSendTransport(clientId: string): Promise<mediasoup.WebRtcTransport> {
    return this.router.createWebRtcTransport({
      listenIps: [{ ip: '0.0.0.0', announcedIp: this.getAnnouncedIp() }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });
  }

  // Create RECEIVE transport for a client (for consuming others' audio)
  async createRecvTransport(clientId: string): Promise<mediasoup.WebRtcTransport> {
    return this.router.createWebRtcTransport({
      listenIps: [{ ip: '0.0.0.0', announcedIp: this.getAnnouncedIp() }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });
  }

  // Get the announced IP — use env var or auto-detect
  private getAnnouncedIp(): string {
    if (process.env.CUECOMMX_ANNOUNCED_IP) {
      return process.env.CUECOMMX_ANNOUNCED_IP;
    }
    // Auto-detect: find the first non-internal IPv4 address
    // IMPORTANT: On multi-NIC servers, log ALL detected interfaces
    // and allow admin to override via CUECOMMX_ANNOUNCED_IP
    return this.detectLocalIp();
  }

  // Client starts producing audio (talking)
  async createProducer(
    transport: mediasoup.WebRtcTransport,
    rtpParameters: mediasoup.RtpParameters
  ): Promise<mediasoup.Producer> {
    return transport.produce({ kind: 'audio', rtpParameters });
  }

  // Client starts consuming audio (listening)
  async createConsumer(
    transport: mediasoup.WebRtcTransport,
    producerId: string,
    rtpCapabilities: mediasoup.RtpCapabilities
  ): Promise<mediasoup.Consumer> {
    if (!this.router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error('Cannot consume');
    }
    return transport.consume({ producerId, rtpCapabilities, paused: false });
  }
}
```

#### Channel Routing Logic

```typescript
// packages/server/src/state/ChannelRouter.ts

export class ChannelRouter {
  // Single-producer model: when a user activates talk, their producer
  // is forwarded to ALL channels where they have active talk.
  // Consumer management controls who hears whom.

  // When a user starts talking (producer resumes), create consumers
  // for all listeners on all of the user's active talk channels
  async handleTalkStart(userId: string): Promise<void> {
    const user = this.getClient(userId);
    const activeChannels = user.activeTalkChannels; // channels marked for talk

    // Resume the user's single producer
    await user.producer.resume();

    for (const channelId of activeChannels) {
      const listeners = this.getChannelListeners(channelId);
      for (const listener of listeners) {
        if (listener.userId === userId) continue; // Don't echo to self
        // Check if consumer already exists (listener may already hear this user
        // from another shared channel)
        if (!this.hasConsumer(listener.userId, user.producer.id)) {
          await this.mediaServer.createConsumer(
            listener.recvTransport,
            user.producer.id,
            listener.rtpCapabilities
          );
        }
      }
    }
  }

  // When a user stops talking (all talk channels), pause their producer
  async handleTalkStop(userId: string): Promise<void> {
    const user = this.getClient(userId);
    await user.producer.pause();
    // Consumers remain but receive no audio (paused producer sends nothing)
  }

  // When a user toggles listen on a channel, manage consumers for
  // all currently-talking users on that channel
  async handleListenStart(userId: string, channelId: string): Promise<void> {
    const talkers = this.getChannelTalkers(channelId);
    const listener = this.getClient(userId);

    for (const talker of talkers) {
      if (!this.hasConsumer(userId, talker.producer.id)) {
        await this.mediaServer.createConsumer(
          listener.recvTransport,
          talker.producer.id,
          listener.rtpCapabilities
        );
      }
    }
  }

  // When a user stops listening on a channel, remove consumers
  // ONLY if the user doesn't hear that talker via another channel
  async handleListenStop(userId: string, channelId: string): Promise<void> {
    const talkers = this.getChannelTalkers(channelId);
    const listener = this.getClient(userId);
    const otherListeningChannels = listener.listeningChannels.filter(c => c !== channelId);

    for (const talker of talkers) {
      // Only remove consumer if this talker isn't heard via another channel
      const heardElsewhere = otherListeningChannels.some(ch =>
        this.getChannelTalkers(ch).some(t => t.userId === talker.userId)
      );
      if (!heardElsewhere) {
        await this.removeConsumer(userId, talker.producer.id);
      }
    }
  }
}
```

#### Database Schema

```sql
-- packages/server/src/db/schema.sql

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  pin_hash TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'operator', 'user')),
  settings_json TEXT DEFAULT '{}',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS channel_permissions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  can_talk BOOLEAN NOT NULL DEFAULT 0,
  can_listen BOOLEAN NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE IF NOT EXISTS server_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Default channels for House of Worship
INSERT OR IGNORE INTO channels (id, name, color, sort_order) VALUES
  ('ch-production', 'Production', '#EF4444', 1),
  ('ch-audio', 'Audio', '#3B82F6', 2),
  ('ch-video', 'Video/Camera', '#10B981', 3),
  ('ch-lighting', 'Lighting', '#F59E0B', 4),
  ('ch-stage', 'Stage', '#8B5CF6', 5);
```

### 3.5 Web Client UI

The live comms screen should feel like a **modern control surface**: dark-first, highly glanceable, with stable channel columns and immediate feedback when Talk state changes.

#### Layout Design (Main Intercom View)

```
┌──────────────────────────────────────────────────────────┐
│  🟢 Connected │ CueCommX - Main Church │ Chuck (Admin)    │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐      │
│  │▓▓▓▓▓▓▓▓▓│ │         │ │▓▓▓▓▓▓▓▓▓│ │         │      │
│  │ PROD    │ │  AUDIO  │ │ VIDEO   │ │ LIGHTS  │      │
│  │         │ │         │ │         │ │         │      │
│  │ 🔊 ━━━━ │ │ 🔊 ━━━━ │ │ 🔊 ━━━━ │ │ 🔊 ━━━━ │      │
│  │         │ │         │ │         │ │         │      │
│  │ ┌─────┐ │ │ ┌─────┐ │ │ ┌─────┐ │ │ ┌─────┐ │      │
│  │ │LISTEN│ │ │ │LISTEN│ │ │ │LISTEN│ │ │ │LISTEN│ │      │
│  │ └─────┘ │ │ └─────┘ │ │ └─────┘ │ │ └─────┘ │      │
│  │ ┌─────┐ │ │ ┌─────┐ │ │ ┌─────┐ │ │ ┌─────┐ │      │
│  │ │ TALK │ │ │ │ TALK │ │ │ │ TALK │ │ │ │ TALK │ │      │
│  │ └─────┘ │ │ └─────┘ │ │ └─────┘ │ │ └─────┘ │      │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘      │
│                                                          │
│  🎤 ━━━━━━━━━━━━━━━━━━━━━━━  🔊 Master ━━━━━━━━━━━━━━  │
└──────────────────────────────────────────────────────────┘
```

#### Mobile Layout (Portrait)

```
┌────────────────────┐
│ 🟢 CueCommX  Chuck  │
├────────────────────┤
│                    │
│ ┌────────────────┐ │
│ │  PRODUCTION    │ │
│ │  🔊━━━━━━━━━━  │ │
│ │ [LISTEN] [TALK]│ │
│ └────────────────┘ │
│ ┌────────────────┐ │
│ │  AUDIO         │ │
│ │  🔊━━━━━━━━━━  │ │
│ │ [LISTEN] [TALK]│ │
│ └────────────────┘ │
│ ┌────────────────┐ │
│ │  VIDEO/CAMERA  │ │
│ │  🔊━━━━━━━━━━  │ │
│ │ [LISTEN] [TALK]│ │
│ └────────────────┘ │
│ ┌────────────────┐ │
│ │  LIGHTING      │ │
│ │  🔊━━━━━━━━━━  │ │
│ │ [LISTEN] [TALK]│ │
│ └────────────────┘ │
│                    │
│ 🎤━━━━  🔊Master━━│
└────────────────────┘
```

### 3.6 Admin Panel UI

The admin UI should feel like a **premium operations dashboard**, not a generic CRUD app: calm spacing, obvious hierarchy, strong contrast, and clear separation between monitoring and destructive controls.

#### Dashboard

```
┌──────────────────────────────────────────────────────────┐
│  CueCommX Admin │ Dashboard │ Users │ Channels │ Settings │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Server: Main Church        Uptime: 4h 23m              │
│  Connected: 12/30 users     Version: 1.0.0              │
│                                                          │
│  ┌─ Connected Users ────────────────────────────────┐   │
│  │ 🟢 Chuck (Admin)    - Production, Video          │   │
│  │ 🟢 Donna (User)     - Production                 │   │
│  │ 🟢 Shawn (User)     - Video/Camera               │   │
│  │ 🟢 Michael (User)   - Video/Camera               │   │
│  │ 🟢 Bill (User)      - Audio                      │   │
│  │ ⚪ Todd (User)      - Offline                    │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌─ Active Channels ───────────────────────────────┐    │
│  │ 🔴 Production    3 listeners, 1 talking          │    │
│  │ 🔵 Audio         2 listeners, 0 talking          │    │
│  │ 🟢 Video/Camera  4 listeners, 2 talking          │    │
│  │ 🟡 Lighting      1 listener,  0 talking          │    │
│  │ 🟣 Stage         0 listeners, 0 talking          │    │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

---

## 4. Implementation Order

The MVP should be built in this specific order, with each phase building on the previous. **Every phase follows TDD: write tests first, then implement.**

### Phase 1: Foundation (Week 1-2)

**Goal:** Project scaffolding, shared types, basic server running. Test infrastructure in place.
**Current status:** Complete in the repo.

1. **Initialize monorepo** with Turborepo
   - Create workspace structure (apps/server, admin-ui, web-client, mobile; packages/protocol, core, design-tokens)
   - Configure TypeScript, ESLint, Prettier across all packages
   - Set up build pipeline
   - **Configure Vitest** across all packages with coverage reporting
   - Set up Tailwind CSS v4 + shadcn/ui + Radix UI for `admin-ui` and `web-client`
   - Create `@cuecommx/design-tokens` for semantic colors, spacing, type scale, radii, elevation, and motion
   - Mirror those tokens into NativeWind config for the mobile app
   - Define canonical live UI states early: talking, listening, latched, force-muted, reconnecting, disconnected

2. **Protocol package** (`@cuecommx/protocol`)
   - **Write tests first** for message serialization/validation
   - Define all TypeScript interfaces and types
   - Signaling message types
   - REST API request/response types
   - Export as compiled package

3. **Server skeleton**
   - **Write tests first** for health check, DB schema, config loading
   - Fastify HTTP server with basic routes
   - SQLite database setup with schema migrations
   - Environment variable configuration
   - Health check endpoint (`GET /api/status`)
   - Basic logging

### Phase 2: Media & Signaling + Platform Spike (Week 3-5)

**Goal:** Audio flows through the server. Two web browsers can talk to each other. Mobile/Docker risks validated.
**Current status:** Complete in the repo for MVP implementation. Shared realtime signaling, mediasoup transport/producer/consumer negotiation, server-side audio routing, browser media capture/playback, reconnect-capable client plumbing, mDNS/admin network confirmation, and Linux/Docker packaging are in place. The remaining work in this phase is manual hardware/load signoff.

4. **mediasoup integration**
   - Single worker initialization with crash recovery
   - Router creation with Opus codec (mono, ptime=10ms, FEC, DTX)
   - Dual WebRTC transport creation (send + receive per client)
   - Producer/consumer management with command queue for pause/resume serialization
   - Network interface detection with `CUECOMMX_ANNOUNCED_IP` override

5. **WebSocket signaling server**
   - Connection handling with heartbeat
   - Authentication message flow
   - WebRTC negotiation message relay with mandatory requestId correlation
   - User state broadcasting
   - Protocol version negotiation

6. **Core client library** (`@cuecommx/core`)
   - WebSocket connection management with auto-reconnect (exponential backoff + jitter)
   - WebRTC session setup (offer/answer/ICE) with dual transports
   - Audio stream management
   - Event emitter for state changes
   - Client state persistence to localStorage

7. **Minimal web test client**
   - Simple HTML page to test audio end-to-end
   - Two browser tabs should be able to talk to each other
   - **This is the critical validation milestone**

8. **🔴 Platform risk spike (CRITICAL — do not skip)**
   - **iOS:** Validate React Native + react-native-webrtc background audio on real hardware
     - Configure AVAudioSession with `.playAndRecord` category
     - Test with `UIBackgroundModes: [audio]`
     - Test with wired headset AND Bluetooth headset (document quality degradation)
   - **Android:** Validate ForegroundService with `FOREGROUND_SERVICE_TYPE_MICROPHONE`
   - **Docker:** Validate Docker image builds and runs on Linux with `network_mode: host`
   - If any spike fails, adjust strategy immediately (native module, LiveKit, etc.)

9. **Docker containerization** (move early to enable testers)
   - Dockerfile for server
   - docker-compose.yml with correct port mapping
   - Volume for persistent data

### Phase 3: Channel Routing (Week 6-7)

**Goal:** Multiple channels work correctly. Users only hear channels they're subscribed to.

10. **Channel routing engine**
   - **Write routing logic tests first** (who hears whom given assignments, talk state, multi-channel scenarios)
   - Channel state management on server
   - Per-channel consumer creation based on single-producer model
   - Talk/listen state tracking
   - Dynamic subscription changes (start/stop listening mid-session)
   - Consumer deduplication (same talker heard via multiple channels = one consumer)

11. **User/channel permission enforcement**
   - **Write permission tests first** (role-based access, unauthorized rejection, edge cases)
   - Validate talk/listen requests against permissions
   - Reject unauthorized channel access

12. **REST API completion**
    - **Write API tests first** (request/response validation, error codes, auth)
    - All CRUD endpoints for users and channels
    - Channel permission assignment endpoints
    - Authentication/authorization middleware
    - Admin force-mute endpoint

### Phase 4: Web Client (Week 8-9)

**Goal:** Fully functional web intercom client.
**Current status:** Functionally complete for MVP scope. Login, manual server handoff, live listen/PTT controls, browser audio negotiation, latch mode, persisted device/listen/volume preferences, RTT/status surfacing, live meter, monitor volume controls, remote talker indicators, and reconnect recovery are in place.

13. **Web client application**
    - Login screen with QR code scan or manual IP entry
    - Channel strip UI with Talk/Listen controls
    - Push-to-talk (mousedown/mouseup or keyboard shortcut)
    - Latch/toggle talk mode
    - Per-channel volume control
    - Audio level metering
    - Connection status display
    - Talking indicators (all active talk channels illuminate)
    - Audio input device selection
    - Auto-reconnection with state restoration from localStorage
    - Use shared tokens and shadcn/Radix primitives for sliders, dialogs, menus, and form controls
    - Ensure visible focus states and keyboard-first operation for live use

### Phase 5: Admin Panel (Week 10-11)

**Goal:** Admins can manage the system through a web UI.
**Current status:** Functionally complete for MVP scope. First-run admin creation, admin login, user CRUD, channel CRUD, permission assignment, real-time roster updates, live talker monitoring, force-mute, QR/manual connect handoff, network-interface confirmation, and mDNS broadcast status are live.

14. **Admin panel application**
    - First-run admin account creation (prompt if none exists)
    - Dashboard with live status, QR code, server URL
    - User CRUD interface (3 roles: admin/operator/user)
    - Channel CRUD interface
    - Permission matrix (assign channels to users)
    - Force-mute controls per user
    - Build and bundle with server
    - Use data-dense but calm layouts built from shared tokens and shadcn/Radix primitives
    - Keep destructive admin actions visually separated and confirm destructive changes where appropriate

### Phase 6: Mobile Clients (Week 12-15)

**Goal:** iOS and Android apps working, with background-audio behavior validated on physical devices before release.
**Current status:** Primary mobile comms flows and runtime hardening are implemented in code. Expo dev-client / prebuild bootstrap, shared tokens, native dependency wiring, manual server handoff, operator login, realtime session shell, native mediasoup audio, listen/talk controls, mic metering, monitor volume controls, Expo AV audio-session configuration, RTCAudioSession activation/deactivation hooks, Talk/Latch haptics, and Android battery/live-audio notification guidance are implemented. Physical-device validation remains open manual signoff, a true Android foreground service still requires native/device follow-up, and automatic mDNS discovery stays deferred beyond MVP.

15. **React Native project setup**
    - Initialize Expo dev-client / prebuild React Native project
    - Integrate `@cuecommx/core` package
    - Integrate NativeWind with shared design tokens
    - Configure `react-native-webrtc` (building on Phase 2 spike findings; Expo Go unsupported)
    - Platform-specific permissions (microphone)
    - iOS: AVAudioSession configuration (.playAndRecord, UIBackgroundModes: [audio])
    - Android: ForegroundService with FOREGROUND_SERVICE_TYPE_MICROPHONE

16. **Mobile UI implementation**
    - Login screen with QR code scan or manual IP entry
    - Channel strip layout (scrollable)
    - Large touch-friendly Talk buttons (minimum 60pt tap target)
    - Latch/toggle talk mode
    - Listen toggles and volume sliders
    - Background audio support implemented in code; physical-device validation still required
    - Screen wake lock (configurable — drains battery)
    - Auto-reconnection with state restoration
    - Use custom intercom components instead of generic mobile business-app widgets for the live comms surface
    - Reanimated is wired into the project; Talk/Latch haptic confirmation is implemented

17. **Platform testing**
    - iOS testing on physical device (wired + Bluetooth headset)
    - Android testing on physical device
    - Background behavior testing (app backgrounded for 90+ min service)
    - WiFi roaming/reconnection testing
    - Battery drain measurement over typical service duration (90-180 min)

### Phase 7: Polish & Testing (Week 16-18)

**Goal:** Stable, tested, ready for real-world use.
**Current status:** Primary MVP flows are implemented and the repo is aligned with the documented testing/tooling baseline. Docker/Linux packaging, compiled asset serving, Playwright web smoke coverage, Detox mobile scaffolding, and automated Vitest coverage thresholds for the targeted packages are in place. Docker deployment has been validated end-to-end; physical mobile and load signoff remain open manual work.

18. **mDNS auto-discovery** (best-effort, not critical)
    - Server broadcasts `_cuecommx._tcp` service
    - Admin and client handoff surfaces expose discovery metadata from `/api/discovery`
    - Document limitations (doesn't work across VLANs, requires `network_mode: host` in Docker)
    - Browser-native client-side service scanning remains deferred beyond MVP

19. **Linux/Docker packaging**
    - Multi-stage Dockerfile for the local CueCommX brain
    - docker-compose deployment using `network_mode: host`
    - Server bundles and serves the admin UI at `/admin` and the operator client at `/`

20. **End-to-end testing**
    - Multi-client audio quality testing
    - Latency measurement (target: <50ms on LAN)
    - Reconnection reliability testing (server restart → all clients recover)
    - Reconnection storm testing (verify backoff + jitter works)
    - Load testing with 15+ simultaneous users
    - Multiple-service-back-to-back testing (clean session transitions)

21. **Error handling hardening**
    - Graceful degradation on network issues
    - Clear error messages for common problems
    - Server crash recovery (auto-restart via PM2)
    - mediasoup worker crash recovery and client notification

22. **Documentation**
    - README with quick-start guide
    - Admin setup documentation
    - Network requirements documentation (same subnet, recommended wired server, VLAN notes)
    - **Wired headset recommendation** (prominently documented; Bluetooth quality degradation warning)
    - Browser/platform support matrix
    - Troubleshooting guide
    - Battery life estimates for mobile devices

---

## 5. Key Technical Decisions

### 5.1 Why mediasoup?

| Alternative | Rejected Because |
|-------------|-----------------|
| **Janus Gateway** | C-based, harder to integrate with Node.js, more complex configuration |
| **LiveKit** | Single Go binary is appealing but introduces Go dependency and is more opinionated. Viable alternative if mediasoup proves problematic. |
| **Pure WebSocket audio** | Too high latency, no hardware acceleration, poor quality |
| **Peer-to-peer mesh** | Doesn't scale past 5-6 users |
| **Custom UDP** | Reinventing the wheel, no encryption, no congestion control |

mediasoup advantages:
- Native Node.js API (TypeScript-friendly)
- C++ worker processes for media handling (high performance)
- Purpose-built for SFU use case
- Active maintenance, large community
- Handles all WebRTC complexity (DTLS, SRTP, ICE, STUN)

### 5.2 Single Producer Per User — All-Channel Talk Model

Each client produces a single audio stream. When the user activates "Talk," that audio is forwarded to ALL channels the user has marked as active for talk. This means:

- Only one WebRTC producer per client (simpler, less bandwidth)
- Talk is "all-or-nothing" — you can't talk on Channel A without also talking on Channel B if both are active
- This matches how hardware intercom belt packs work (your mic goes to all active channels)
- Switching which channels are "talk active" is a server-side routing change, not a WebRTC renegotiation

**UI implication:** When the user presses Talk, ALL active talk channel indicators should illuminate to make this behavior clear.

> **Future enhancement:** Per-channel independent talk (talking on one channel but not another simultaneously) requires creating multiple producers per user. This is planned as a post-MVP feature.

### 5.3 Push-to-Talk & Latch Implementation

**Web:**
- PTT: Mouse: `mousedown` → `talk:start`, `mouseup` → `talk:stop`; Keyboard: Spacebar hold or configurable key; Touch: `touchstart`/`touchend`
- Latch: Click to toggle talk on/off (client tracks latch state; server just receives start/stop)

**Mobile:**
- PTT: `onPressIn` → `talk:start`, `onPressOut` → `talk:stop`
- Latch: Tap to toggle
- Haptic feedback on press/release

**Server-side implementation:** Use mediasoup's `producer.pause()` / `producer.resume()` for talk state control. This prevents RTP packets from being forwarded without affecting the WebRTC transport. Since talk is all-or-nothing in the single-producer model, pause/resume correctly affects all channels simultaneously.

> **Note:** Muting a WebRTC track (`track.enabled = false`) does NOT cause reconnection — the common warning about this is incorrect. However, server-side pause/resume is still preferred because it stops RTP forwarding at the SFU level, saving bandwidth.

**Race condition mitigation:** Rapid PTT press/release can cause `resume()` and `pause()` to interleave. Use a command queue per-producer to serialize pause/resume operations.

**Release hang time:** Add a configurable release delay (100-200ms) to prevent clipped word endings on PTT release.

### 5.4 Client-Side Audio Mixing

Each client receives individual audio streams from the SFU (one per talker they should hear). The browser/device mixes these natively via the WebRTC audio pipeline. Per-channel volume control is achieved by adjusting the gain on each incoming audio track using the Web Audio API (`GainNode`).

```typescript
// Volume control per incoming stream using Web Audio API
// NOTE: Use MediaStreamAudioSourceNode, not createMediaElementSource
// (the latter can only be called once per element and breaks on reconnection)
const audioContext = new AudioContext();

function createChannelAudioPipeline(stream: MediaStream, volume: number) {
  const source = audioContext.createMediaStreamSource(stream);
  const gainNode = audioContext.createGain();
  gainNode.gain.value = volume; // 0.0 to 1.0
  source.connect(gainNode);
  gainNode.connect(audioContext.destination);
  return { source, gainNode };
}
```

> **AudioContext policy:** Browsers (especially mobile Safari) create AudioContext in a `suspended` state. The app must call `audioContext.resume()` on the first user interaction (login button tap, "tap to activate audio" overlay). Without this, the first PTT press will be silent.

> **React Native:** Web Audio API (`AudioContext`, `GainNode`, etc.) is NOT available in React Native. The `@cuecommx/core` package must define an abstraction boundary. Mobile volume control uses `react-native-webrtc`'s native audio APIs or platform-specific audio route management.

---

## 6. Configuration Reference

### Environment Variables

```bash
# Server identity
CUECOMMX_SERVER_NAME="Main Church"     # Display name for this server
CUECOMMX_PORT=3000                     # HTTP/HTTPS + WebSocket port
CUECOMMX_HOST=0.0.0.0                  # Bind address
CUECOMMX_TLS_CERT_FILE=                # Optional PEM certificate path to enable HTTPS/WSS
CUECOMMX_TLS_KEY_FILE=                 # Optional PEM private key path to enable HTTPS/WSS

# Media
CUECOMMX_RTC_MIN_PORT=40000            # WebRTC RTP port range start
CUECOMMX_RTC_MAX_PORT=41000            # WebRTC RTP port range end (need ~4 ports per user)
CUECOMMX_ANNOUNCED_IP=                 # Public IP for WebRTC (auto-detect if empty)
CUECOMMX_NUM_WORKERS=                  # mediasoup workers (auto = CPU cores)

# Database
CUECOMMX_DATA_DIR=./data               # Directory for SQLite DB and config
CUECOMMX_DB_FILE=cuecommx.db            # Database filename

# Limits
CUECOMMX_MAX_USERS=30                  # Maximum simultaneous connections
CUECOMMX_MAX_CHANNELS=16               # Maximum channels

# Logging
CUECOMMX_LOG_LEVEL=info                # debug | info | warn | error
```

> For iPhone/iPad browser audio, HTTPS must use a certificate the device trusts. A self-signed certificate can start CueCommX locally, but Safari/WebKit will still require that certificate chain to be trusted on the device before microphone access is exposed.

---

## 7. Testing Strategy — Test-Driven Development (TDD)

**CueCommX follows a strict test-driven development approach.** For every feature, the workflow is:

1. **Write failing tests** that define the expected behavior
2. **Write the minimum code** to make the tests pass
3. **Refactor** while keeping tests green

### Test Tooling

| Layer | Tool | Purpose |
|-------|------|---------|
| Unit tests | **Vitest** | All packages — protocol, core, server logic |
| Integration tests | **Vitest** + **supertest** | HTTP/WebSocket API flows |
| E2E tests (web) | **Playwright** | Full browser-based audio pipeline |
| E2E tests (mobile) | **Detox** | iOS/Android app flows |
| Coverage | **Vitest coverage (v8)** | Enforce minimum coverage thresholds |

### TDD Workflow Per Phase

Every implementation phase follows this cycle:

```
1. Define behavior as test cases (unit + integration)
2. Run tests → all new tests FAIL (red)
3. Implement feature code
4. Run tests → all tests PASS (green)
5. Refactor for clarity/performance
6. Run tests → still green
7. Commit
```

### Unit Tests (write FIRST, before implementation)

- **Protocol package:** Message serialization/deserialization, type validation, schema enforcement
- **Server — Channel routing logic:** Who hears whom given channel assignments, talk state, permissions
- **Server — Permission validation:** Role-based access control (admin/operator/user), force-mute authorization
- **Server — User/channel CRUD:** Database operations, constraint enforcement, duplicate handling
- **Core — Reconnection logic:** Backoff timing, jitter calculation, state restoration from localStorage
- **Core — State management:** Channel state transitions, talk/listen toggle logic, latch mode

### Integration Tests (write FIRST, before wiring up endpoints)

- WebSocket signaling flow: connect → auth → negotiate → talk → listen → disconnect
- REST API endpoints: user CRUD, channel CRUD, permission matrix
- mediasoup transport creation and producer/consumer lifecycle
- Channel routing integration: producer pause/resume → consumer receives/stops audio
- Reconnection flow: server restart → client reconnects → state restored

### End-to-End Tests (write after unit/integration, before polish)

- Full audio pipeline: Client A talks → Server routes → Client B hears
- Multi-channel routing: Client talks on Ch1, only Ch1 listeners hear
- Reconnection: Client disconnects and reconnects, audio resumes
- Permission enforcement: Unauthorized talk attempt rejected
- Admin force-mute: Admin mutes user → user's audio stops for all listeners
- Latch mode: User latches talk → audio persists → user unlatches → audio stops

### Coverage Requirements

| Package | Minimum Coverage |
|---------|-----------------|
| `@cuecommx/protocol` | 95% |
| `@cuecommx/server` (routing, permissions, CRUD) | 85% |
| `@cuecommx/core` (state, reconnection) | 80% |
| `@cuecommx/web-client` | 60% (UI components are harder to unit test) |
| `@cuecommx/admin-ui` | 60% |

> **Current repo snapshot:** `@cuecommx/protocol` 100%, `@cuecommx/server` 85.68%, `@cuecommx/core` 95.57%, `@cuecommx/web-client` 65.67%, `@cuecommx/admin-ui` 87.54%.

### UI/UX Acceptance Criteria

- Talk, listen, latched, force-muted, reconnecting, and disconnected states are visually distinct and never rely on color alone
- Web client supports keyboard operation with visible focus and no awkward focus traps in the live view
- Mobile Talk buttons meet the 60pt minimum and provide immediate visual + haptic confirmation
- No layout shift occurs when users start or stop talking
- Destructive admin actions are clearly separated from routine controls

### Manual Testing Checklist (supplement, not replacement for automated tests)

Automated coverage now exists for protocol validation, auth/bootstrap, admin user CRUD, websocket signaling, reconnect logic, and the current admin/web UI flows. The manual checklist below is still open signoff work.

- [ ] Admin creates users and channels
- [ ] Web client connects and authenticates
- [ ] Two web clients can talk via PTT on same channel
- [ ] Latch mode works (toggle on/off)
- [ ] Volume control works per-channel
- [ ] Client auto-reconnects after server restart
- [ ] iOS app connects and audio works
- [ ] Android app connects and audio works
- [ ] Audio continues when mobile app is backgrounded
- [ ] 10+ simultaneous users with acceptable latency
- [x] Docker deployment works end-to-end
- [ ] QR code scan connects mobile client

---

## 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **iOS background audio in React Native** | **CRITICAL — project viability risk** | Spike in Phase 2 on real hardware; test AVAudioSession + UIBackgroundModes; have native module or LiveKit as fallback |
| Bluetooth headset quality degradation | Poor audio on AirPods/BT | Prominently recommend wired headsets; test in Phase 2 spike; document limitations |
| WebRTC NAT traversal on complex networks | Audio doesn't connect | Server on same subnet; VLAN documentation; QR code/manual IP fallback |
| React Native WebRTC bugs | Mobile audio issues | Validate early (Phase 2 spike); web client as fallback |
| WiFi latency/jitter | Poor audio quality | Recommend wired server; Opus FEC + DTX; bandwidth adaptation post-MVP |
| Browser autoplay restrictions | Audio won't play | "Tap to activate audio" overlay; AudioContext.resume() on user gesture |
| Reconnection storm on server restart | Server overwhelmed | Exponential backoff with jitter on client reconnect |
| mediasoup worker crashes | Audio drops for all users | Worker `died` event handling; auto-respawn; client notification |
| Multi-NIC server picks wrong IP | Audio routes to wrong interface | Log all interfaces on startup; CUECOMMX_ANNOUNCED_IP override; admin confirmation in UI |
| mDNS fails on church network | Clients can't find server | QR code as primary discovery; manual IP as fallback; mDNS as best-effort |
