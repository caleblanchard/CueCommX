# CueCommX — Post-MVP Feature Roadmap

This document details all features planned after the MVP, organized by priority tier. Each feature includes a description, rationale, implementation approach, and estimated complexity.

> **Note:** Feature priorities were adjusted based on multi-agent architecture review consensus. Key changes:
> - Noise suppression, program audio feeds, and connection quality moved UP to Tier 1 (critical for HoW use case)
> - IFB, preflight audio test added to Tier 1
> - Confidence monitoring, sidetone, headset button PTT added to Tier 2
> - Text chat moved DOWN to Tier 3 (not a standard intercom feature)
> - AES-256 encryption deprioritized (WebRTC already encrypts with DTLS-SRTP)
> - Multi-server redundancy deprioritized (overkill for target market)
> - Force-mute and operator role basics are now in MVP; Tier 1 entries cover advanced functionality
> - All post-MVP UI work must continue using the shared design tokens, component patterns, and UI/UX ground rules established in the MVP

---

## Priority Tier 1: High Priority (Implement First After MVP)

These features address the most common requests from professional AV users and fill gaps that limit daily usability.

---

### 1.1 VOX (Voice-Activated) Mode ✅ IMPLEMENTED

> **Status:** Implemented in commit `564ee1f`. Web client has full VOX support with adjustable threshold and hold time. VoxDetector class in `apps/web-client/src/media/vox-detector.ts`. Preferences persisted. Mobile app does not yet have VOX UI (web-only for now).

**Description:**
Voice-operated exchange (VOX) automatically activates the user's microphone when they speak, without requiring them to press and hold a Talk button. An adjustable threshold determines what audio level triggers transmission.

**Rationale:**
Essential for users whose hands are occupied (e.g., camera operators, stage managers, instrument players). This is a standard feature in every professional intercom system (Clear-Com, RTS, Unity, Green-GO).

**Implementation:**
```typescript
// Client-side VOX detection using Web Audio API
class VoxDetector {
  private analyser: AnalyserNode;
  private threshold: number; // dB, configurable
  private holdTime: number;  // ms, how long to keep open after speech stops
  private isActive: boolean = false;
  private holdTimeout: NodeJS.Timeout | null = null;

  constructor(stream: MediaStream, threshold: number = -40, holdTime: number = 500) {
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);
    this.threshold = threshold;
    this.holdTime = holdTime;
  }

  // Called on animation frame
  detect(): boolean {
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    const rms = Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length);
    const dB = 20 * Math.log10(rms);

    if (dB > this.threshold) {
      this.isActive = true;
      if (this.holdTimeout) clearTimeout(this.holdTimeout);
      this.holdTimeout = setTimeout(() => { this.isActive = false; }, this.holdTime);
    }
    return this.isActive;
  }
}
```

**User-Configurable Settings:**
- Threshold level (slider from -60dB to -10dB)
- Hold time (how long mic stays open after speech stops: 200ms–2000ms)
- Per-channel VOX enable/disable

**Complexity:** Medium  
**Dependencies:** MVP audio pipeline  
**Estimated effort:** 1-2 weeks

---

### 1.2 All-Page (System-Wide Broadcast) ✅ IMPLEMENTED

> **Status:** Implemented in commit `564ee1f`. Server-side routing, protocol messages (`allpage:start`/`allpage:stop`/`allpage:active`), admin permission checks, and web client UI all complete. Admin UI shows All-Page controls.

**Description:**
An admin or authorized user can press an "All-Page" button to broadcast their voice to ALL channels simultaneously, temporarily overriding normal channel routing. All other talk activity is suppressed while All-Page is active.

**Rationale:**
Critical for production directors and technical directors who need to address the entire crew at once (e.g., "Stand by for service start", "All hold positions"). This is a core feature in every professional intercom system.

**Implementation:**

Server-side:
- When a user with All-Page permission activates it, the server:
  1. Pauses all other producers (server-side mute)
  2. Creates consumers on ALL listening users for the All-Page producer
  3. Broadcasts `allpage:active` state to all clients
  4. When released, resumes all paused producers and removes temporary consumers

Client-side:
- All-Page button in the UI (admin/operator only)
- Visual indicator on all clients when All-Page is active (full-screen flash or banner)
- Audio indicator: optional tone before All-Page audio plays

**Complexity:** Medium  
**Dependencies:** MVP channel routing  
**Estimated effort:** 1 week

---

### 1.3 Private / Direct User-to-User Communication ✅ IMPLEMENTED

**Description:**
A user can initiate a private conversation with one other user, bypassing the channel system. This creates a temporary point-to-point audio link that only those two users can hear.

**Rationale:**
Essential in production environments. A director may need to give private notes to a camera operator without the entire channel hearing. Unity Intercom calls this "Direct User Channel"; Green-GO calls it "Direct Communication".

**Implementation:**
- UI: User list showing online users; tap a user to initiate direct call
- Server creates a temporary private channel with only two consumers
- Visual indicator on both clients showing active direct call
- Either party can end the direct call
- Direct call audio is separate from party-line channels (user can still listen to channels while in a direct call)
- Optional: ability to "whisper" (talk to direct user without dropping channel talk)

**Complexity:** Medium  
**Dependencies:** MVP user state, channel routing  
**Estimated effort:** 1-2 weeks

---

### 1.4 Groups (Channel Collections) ✅ IMPLEMENTED

**Description:**
Groups are named presets of channels that are presented together in the client UI. A user assigned to a group sees only the channels in that group. Users can switch between groups to access different sets of channels.

**Rationale:**
With 8-16 channels, not every user needs to see all of them. Groups simplify the UI:
- "Camera Crew" group shows: Production, Video/Camera
- "Audio Team" group shows: Production, Audio
- "Director" group shows: Production, Audio, Video, Lighting, Stage

This mirrors Unity Intercom's group system and is standard in matrix intercom systems.

**Implementation:**

Data model:
```typescript
interface Group {
  id: string;
  name: string;
  channelIds: string[];  // Which channels appear in this group
}

// Users can be assigned to multiple groups
// UI shows a group switcher (tabs or dropdown)
```

Admin panel:
- Create/edit/delete groups
- Drag-and-drop channels into groups
- Assign groups to users

Client:
- Group selector (tabs or swipe-able pages on mobile)
- Switching groups changes visible channels
- Audio subscription follows: listen state resets on group switch

**Complexity:** Medium  
**Dependencies:** MVP channels, admin panel  
**Estimated effort:** 2 weeks

---

### 1.5 Global / Sticky Channels ✅ IMPLEMENTED

**Description:**
Channels marked as "global" remain visible and active regardless of which group the user switches to. For example, the "Production" channel might be global, so the director always has it available whether they're viewing the Camera group or the Audio group.

**Rationale:**
Without this, switching groups disconnects you from critical channels. Unity Intercom Pro implements this exact feature and calls them "global" or "sticky" channels.

**Implementation:**
- Channel property: `isGlobal: boolean`
- When rendering group view, global channels always appear at the top
- Listen/talk state for global channels persists across group switches
- Admin configures which channels are global

**Complexity:** Low (once Groups are implemented)  
**Dependencies:** Groups feature  
**Estimated effort:** 3-5 days

---

### 1.6 Admin Force-Mute & Unlatch (Advanced) ✅ IMPLEMENTED

> **Status:** Implemented in commit `28f16ef`. Server-side force-mute per user, unlatch-all per channel, protocol messages, admin UI controls, and client-side visual notifications all complete.

> **Note:** Basic force-mute is included in the MVP admin panel. This feature covers advanced unlatch-all-channel functionality and richer admin controls.

**Description:**
Admin users can:
1. **Force-mute** a specific user (disable their producer on the server)
2. **Unlatch all** — force all latched/VOX microphones on a channel to close

**Rationale:**
Open microphones in noisy environments are a constant problem. The admin needs the ability to silence a mic that's been left open (e.g., someone walked away with their mic latched on in a noisy room). Unity Intercom's admin "Unlatch" feature addresses this.

**Implementation:**

Server:
```typescript
// Admin force-mute: pause a specific user's producer
async forceMuteUser(adminId: string, targetUserId: string): Promise<void> {
  this.validateAdmin(adminId);
  const producer = this.getProducer(targetUserId);
  await producer.pause();
  this.broadcast({ type: 'user:force-muted', payload: { userId: targetUserId } });
}

// Unlatch all: pause all producers on a channel
async unlatchChannel(adminId: string, channelId: string): Promise<void> {
  this.validateAdmin(adminId);
  const talkers = this.getChannelTalkers(channelId);
  for (const talker of talkers) {
    await talker.producer.pause();
  }
  this.broadcast({ type: 'channel:unlatched', payload: { channelId } });
}
```

Client:
- Admin panel shows "Mute" button next to each connected user
- Admin panel shows "Unlatch All" button per channel
- Muted user sees visual notification they've been force-muted
- User must manually re-enable talk after being force-muted

**Complexity:** Low-Medium  
**Dependencies:** MVP admin panel, channel routing  
**Estimated effort:** 1 week

---

### 1.7 Call Signaling (Visual & Audible Alerts) ✅ IMPLEMENTED

> **Status:** Implemented in commit `564ee1f`. Protocol messages (`call:send`/`call:received`), server routing, web client send/receive UI with visual flash indicators, and audible alert tones all complete.

**Description:**
Users can send a "call" signal to a channel or specific user. This produces a visual flash and optional audible tone on the receiving end, even if the receiver isn't currently listening to that channel.

**Rationale:**
Call signaling is how you get someone's attention before talking. In hardware intercom systems, this is a dedicated "Call" button that flashes a light and plays a tone on the target station. Essential for "standby" and "go" cues.

**Implementation:**

Types of signals:
| Signal | Description | Use Case |
|--------|-------------|----------|
| **Call** | Flashing indicator + tone on target | "I need to talk to you" |
| **Standby** | Steady amber indicator on target | "Prepare for your cue" |
| **Go** | Flashing green indicator on target | "Execute your cue now" |

Client UI:
- Long-press or dedicated button on a channel to send a call
- Signal type selector (call / standby / go)
- Receiving client shows animated indicator (flash, pulse, color change)
- Optional audible alert tone (configurable per user: on/off/vibrate-only on mobile)
- Call signal persists until acknowledged or timed out

**Complexity:** Medium  
**Dependencies:** MVP signaling  
**Estimated effort:** 1-2 weeks

---

### 1.8 Operator Role (Advanced Permissions) ✅ IMPLEMENTED

> **Status:** Implemented in commit `28f16ef`. Three-role permission matrix (admin/operator/user), operator-specific capabilities (force-mute, unlatch, All-Page, view all), and role-based UI visibility all complete.

> **Note:** The MVP includes the 3-role system (admin/operator/user) in the data model. This feature covers the full permission matrix and operator-specific UI capabilities.

**Description:**
Add a third role between admin and user: **operator**. Operators can manage day-to-day operations (force-mute, unlatch, All-Page) but cannot create/delete users or channels.

**Rationale:**
The technical director running a service needs operational control but shouldn't have full admin access. Three roles:
- **Admin:** Full system configuration access
- **Operator:** Force-mute, unlatch, All-Page, view all users
- **User:** Basic talk/listen on assigned channels

**Implementation:**
```typescript
type UserRole = 'admin' | 'operator' | 'user';

const rolePermissions = {
  admin: ['manage_users', 'manage_channels', 'force_mute', 'unlatch', 'all_page', 'view_all'],
  operator: ['force_mute', 'unlatch', 'all_page', 'view_all'],
  user: [],
};
```

**Complexity:** Low  
**Dependencies:** MVP role system  
**Estimated effort:** 3-5 days

---

### 1.9 Noise Suppression & Automatic Gain Control ✅ IMPLEMENTED

> **Status:** Implemented in commit `28f16ef`. WebRTC built-in noiseSuppression and autoGainControl enabled via getUserMedia constraints. User-facing toggles in web client preferences with persistence. Mobile uses platform defaults.

> **Moved UP from Tier 2.** Nearly free to implement using built-in WebRTC constraints. Critical for noisy HoW environments.

**Description:**
Built-in audio processing to clean up microphone input:
- **Noise suppression:** Remove background noise (HVAC, crowd noise)
- **AGC (Automatic Gain Control):** Normalize mic levels so quiet speakers and loud speakers are heard at similar volumes

**Rationale:**
Houses of worship have varying acoustic environments. Crew members may be in a loud sanctuary, a quiet control room, or outdoors. Consistent audio quality requires processing. This is essentially free because WebRTC provides built-in audio processing — it just needs UI toggles.

**Implementation:**
- Use WebRTC's built-in audio processing (enabled by default):
```typescript
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  }
});
```
- Add user-facing toggles to enable/disable each processing type
- Store preferences in user profile
- Advanced (future): Use RNNoise (neural network noise suppression) for superior quality via WebAssembly

**Complexity:** Low (WebRTC built-in) to Medium (RNNoise integration)  
**Dependencies:** MVP audio pipeline  
**Estimated effort:** 3-5 days (built-in), 3 weeks (RNNoise)

---

### 1.10 Program Audio Feeds ✅ IMPLEMENTED

> **Moved UP from Tier 2.** Critical for houses of worship where crew must hear the worship mix, pastor, or other audio to do their jobs.

**Description:**
Listen-only audio channels that carry program material (e.g., live audio mix, music, pastor's mic feed). Users can select program feeds to monitor in their headset without being able to talk on them.

**Rationale:**
Camera operators need to hear the speaker to know when to cut. Stage managers need to hear the worship leader. Sound engineers need to hear FOH while on intercom. Unity Intercom charges $530 for their "Advanced Program Feed License." This is arguably the #1 feature request after basic intercom.

**Implementation:**
- New channel type: `program` (listen-only, no talk capability)
- Audio input: Server accepts audio via a WebRTC producer from a designated "source" client
- Source client could be a computer running the audio mix, connected to CueCommX as a program feed source
- Program feed volume is independently adjustable per user
- Split-ear option: program in one ear, intercom in the other (see Split-Ear Audio feature)

**Alternative input methods (future):**
- Direct audio capture from a sound card on the server
- NDI input
- Dante/AES67 input (see Tier 3)

**Complexity:** Medium  
**Dependencies:** MVP channel system  
**Estimated effort:** 2 weeks

---

### 1.11 Connection Quality Indicators ✅ IMPLEMENTED

> **Status:** Implemented in commit `e39137f`. Client-side WebRTC stats collection, quality level calculation (good/fair/poor), quality badge in web client UI, and server-side stats reporting via protocol messages all complete.

> **Moved UP from Tier 2.** Essential for troubleshooting WiFi issues during live services — problems must be identified before they disrupt communications.

**Description:**
Display real-time network quality metrics for each user:
- Latency (round-trip time)
- Packet loss percentage
- Jitter
- Connection quality icon (good/fair/poor)

**Rationale:**
On WiFi networks, some users may experience poor connections. Visible quality indicators help admins identify and troubleshoot problems before they affect the production. Churches typically have varying WiFi quality across their campus.

**Implementation:**
- Use WebRTC `RTCPeerConnection.getStats()` to retrieve transport statistics
- Calculate jitter, packet loss, and round-trip time
- Send periodic stats to server for admin dashboard (throttled to every 5 seconds)
- Client shows quality indicator icon:
  - 🟢 Good: <50ms latency, <1% loss
  - 🟡 Fair: <100ms latency, <5% loss
  - 🔴 Poor: >100ms latency or >5% loss
- Admin dashboard shows per-user connection status at a glance

**Complexity:** Medium  
**Dependencies:** MVP WebRTC pipeline  
**Estimated effort:** 1 week

---

### 1.12 IFB (Interrupted Fold-Back) ✅ IMPLEMENTED

> **New feature** — standard in broadcast and increasingly requested in large HoW productions.

**Description:**
IFB allows a director to interrupt a program audio feed to talk directly into a specific user's ear. The program audio ducks (or mutes) while the director speaks, then returns to normal when they stop.

**Rationale:**
In broadcast, IFB is how a director talks to an on-air talent while they're listening to the program feed. In HoW, a worship leader or pastor listening to a confidence mix needs to hear the director's instructions clearly. This is the combination of program audio feeds + audio ducking + directed talk in a single integrated workflow.

**Implementation:**
- Builds on Program Audio Feeds (1.10)
- Director selects a user and initiates IFB talk
- Server pauses/ducks program audio consumer for that user
- Director's audio is routed as a priority stream to the target user
- When director releases talk, program audio resumes at full level
- Visual indicator on target user's device: "IFB ACTIVE" with director name
- Duck level configurable (full mute vs. partial duck)

**Complexity:** Medium-High  
**Dependencies:** Program Audio Feeds (1.10), Audio Ducking concept  
**Estimated effort:** 2 weeks

---

### 1.13 Preflight Audio Test ✅ IMPLEMENTED

> **Status:** Implemented in commit `e39137f`. Web client has full preflight test flow: test tone playback, mic recording + playback, level analysis, pass/fail indicator. PreflightAudioTest class in `apps/web-client/src/media/preflight-audio-test.ts`.

> **New feature** — critical for volunteer-heavy environments where users may have misconfigured audio.

**Description:**
A self-service audio check that users can run before a service to verify their microphone and speakers are working correctly.

**Rationale:**
In a HoW setting, volunteers arrive 30-60 minutes before a service. A "check your audio" flow ensures their device is properly configured before the service starts, preventing "can you hear me?" moments during the production.

**Implementation:**
- "Test Audio" button in user settings
- Step 1: Play a test tone to verify output device is working
- Step 2: Record 3 seconds of mic input, play it back so user can hear themselves
- Step 3: Show mic level meter and confirm levels are in acceptable range
- Results: Pass/Fail indicator visible to admin dashboard
- Optional: admin can see which users have NOT completed preflight check

```typescript
async runPreflightTest(): Promise<PreflightResult> {
  // 1. Test output
  const outputOk = await this.playTestTone(440, 1000); // 440Hz for 1 second
  // 2. Test input
  const recording = await this.recordMic(3000); // 3 seconds
  const level = this.analyzeLevel(recording);
  await this.playbackRecording(recording);
  // 3. Return results
  return { outputOk, inputLevel: level, inputOk: level > -40 }; // dBFS threshold
}
```

**Complexity:** Low-Medium  
**Dependencies:** MVP audio pipeline  
**Estimated effort:** 1 week

---

## Priority Tier 2: Medium Priority

These features enhance the user experience and add professional capabilities, but the system is usable without them.

---

### 2.1 ~~Program Audio Feeds~~ → Moved to Tier 1 (1.10)

---

### 2.2 ~~Text Chat / Messaging~~ → Moved to Tier 3 (3.18)

> **Moved DOWN.** Professional intercom systems do not include text chat. While useful as a supplementary feature, it is not a standard intercom capability and should not distract from core audio functionality.

---

### 2.3 User Profiles & Presets ✅ IMPLEMENTED

**Description:**
Users can save their preferred settings (volume levels, listen defaults, audio mode, device selection) as a profile that persists between sessions.

**Rationale:**
Volunteers at a house of worship use the same device each week. They shouldn't have to reconfigure their volume and channel preferences every time they log in.

**Implementation:**
- User settings stored in server database (associated with user account)
- On login, client receives and applies saved settings
- "Save current settings" button in client
- Settings include: per-channel volumes, listen defaults, master volume, audio mode (PTT/latch/VOX), VOX threshold, input gain

**Complexity:** Low  
**Dependencies:** MVP user system  
**Estimated effort:** 1 week

---

### 2.4 Audio Ducking (Priority Channel System) ✅ IMPLEMENTED

**Description:**
When audio is active on a high-priority channel, audio from lower-priority channels is automatically reduced in volume (ducked). When the priority channel goes silent, other channels return to normal volume.

**Rationale:**
When the director speaks on the Production channel, you want their voice to be clearly heard over the chatter on other channels. This is a standard feature in professional intercom and broadcast mixing.

**Implementation:**
```typescript
// Client-side ducking using Web Audio API
class AudioDucker {
  private channelGains: Map<string, GainNode>;
  private channelPriorities: Map<string, number>;
  private duckLevel: number = 0.3; // Duck to 30% volume
  private duckAttack: number = 50; // ms to duck
  private duckRelease: number = 300; // ms to unduck

  onChannelActive(channelId: string): void {
    const priority = this.channelPriorities.get(channelId) || 0;
    // Duck all channels with lower priority
    for (const [id, gain] of this.channelGains) {
      const otherPriority = this.channelPriorities.get(id) || 0;
      if (otherPriority < priority) {
        gain.gain.linearRampToValueAtTime(
          this.duckLevel,
          audioContext.currentTime + this.duckAttack / 1000
        );
      }
    }
  }
}
```

- Channel priority configured in admin panel (1-10 scale)
- Ducking is client-side only (each user can adjust their duck level)
- Configurable duck amount (how much to reduce) and timing

**Complexity:** Medium  
**Dependencies:** MVP audio pipeline, channel volume control  
**Estimated effort:** 1-2 weeks

---

### 2.5 ~~Noise Suppression & AGC~~ → Moved to Tier 1 (1.9)

---

### 2.6 Enhanced Audio Level Metering ✅ IMPLEMENTED

**Description:**
Visual VU meters showing:
- Own microphone input level
- Per-channel audio levels
- Per-user audio levels within a channel

**Rationale:**
Visual feedback helps users verify their mic is working and at a good level, and helps admins identify who is talking and if anyone's level is too hot or too low.

**Implementation:**
- Use Web Audio API `AnalyserNode` for real-time level data
- Client sends periodic audio level data to server via signaling (throttled to ~10 updates/sec)
- Server broadcasts aggregated level data to admin clients
- UI: Horizontal or vertical bar meters with peak hold

**Complexity:** Low-Medium  
**Dependencies:** MVP audio pipeline  
**Estimated effort:** 1 week

---

### 2.7 Keyboard Shortcuts & Accessibility ✅ IMPLEMENTED

**Description:**
Configurable keyboard shortcuts for the web client:
- Spacebar: Push-to-talk on default/selected channel
- Number keys (1-9): Talk on specific channel
- F-keys: Toggle listen on specific channel
- Tab: Cycle through channels
- Escape: Stop all talk

**Rationale:**
Power users (directors, stage managers) need fast access without mousing. Keyboard shortcuts are essential for desktop-based operators.

**Implementation:**
```typescript
const defaultShortcuts = {
  'ptt-global': 'Space',
  'ptt-ch1': 'Digit1',
  'ptt-ch2': 'Digit2',
  // ...
  'listen-ch1': 'F1',
  'listen-ch2': 'F2',
  // ...
  'stop-all': 'Escape',
  'all-page': 'Backquote', // ` key
};
```
- Shortcuts panel in settings
- Custom key binding (click to rebind)
- Prevent browser default actions on shortcut keys

**Complexity:** Medium  
**Dependencies:** MVP web client  
**Estimated effort:** 1-2 weeks

---

### 2.8 Split-Ear Audio (Stereo Channel Panning) ✅ IMPLEMENTED

**Description:**
When using a stereo/dual-ear headset, users can pan individual channels left or right. For example:
- Production channel in the left ear
- Program audio feed in the right ear
- Camera channel centered (both ears)

**Rationale:**
This is how professional broadcast operators work — they separate program audio from intercom so they can hear both clearly. Unity Intercom charges $530 for this feature in their "Advanced Program Feed License."

**Implementation:**
```typescript
// Using Web Audio API StereoPannerNode
const panNode = audioContext.createStereoPanner();
panNode.pan.value = -1; // -1 = full left, 0 = center, 1 = full right
source.connect(panNode);
panNode.connect(audioContext.destination);
```
- Per-channel pan control (slider from L to R)
- Quick preset buttons: Left / Center / Right
- Saved in user profile

**Complexity:** Low  
**Dependencies:** MVP audio pipeline  
**Estimated effort:** 3-5 days

---

### 2.9 ~~Connection Quality Indicators~~ → Moved to Tier 1 (1.11)

---

### 2.10 System Event Logging ✅ IMPLEMENTED

**Description:**
Log all significant system events to a queryable log:
- User connect/disconnect
- Talk start/stop
- Channel changes
- Admin actions (user created, muted, etc.)
- Errors and warnings

**Rationale:**
Post-event review and troubleshooting. "Who was talking on Production when the issue happened?" Audit trail for admin actions.

**Implementation:**
- Server writes structured log entries to SQLite table
- Admin panel: log viewer with filtering (by user, channel, time range, event type)
- Log rotation: auto-delete entries older than configurable period (default 30 days)
- Export to CSV

**Complexity:** Low-Medium  
**Dependencies:** MVP server  
**Estimated effort:** 1 week

---

### 2.11 Confidence Monitoring ✅ IMPLEMENTED

> **New feature** — essential for worship leaders and pastors who wear IEMs.

**Description:**
A simplified monitoring feed where key personnel (pastor, worship leader) can hear a confidence mix through CueCommX while also receiving intercom communication. Different from IFB in that confidence monitoring is a persistent low-level feed, not an interrupt-based system.

**Rationale:**
In many HoW setups, the pastor or worship leader wears IEMs for their monitor mix. If they're also on intercom, they need both feeds blended. Confidence monitoring gives them their mix through CueCommX so they only need one device in their ear.

**Implementation:**
- Special channel type: `confidence` (listen-only, persistent, doesn't duck)
- Audio source: WebRTC producer from a monitor mix output
- Client UI: dedicated confidence feed section with independent volume
- Key difference from program feeds: confidence feeds are always on and do not respond to ducking or IFB interrupts

**Complexity:** Low-Medium  
**Dependencies:** Program Audio Feeds (1.10)  
**Estimated effort:** 1 week

---

### 2.12 Sidetone ✅ IMPLEMENTED

> **New feature** — prevents the "talking into a void" feeling when wearing closed-back headphones.

**Description:**
Local audio bypass that lets users hear their own voice in their headphones at a low level. This is NOT a server round-trip — it must be implemented entirely in the local audio pipeline.

**Rationale:**
When wearing closed-back headphones or IEMs, not hearing your own voice is disorienting. Professional intercom systems provide sidetone as a standard feature. Critical implementation note: routing sidetone through the server would add ~50ms+ delay and cause an echo effect. It MUST be a local Web Audio bypass.

**Implementation:**
```typescript
// LOCAL sidetone — no server round-trip
function enableSidetone(micStream: MediaStream, level: number = 0.15) {
  const source = audioContext.createMediaStreamSource(micStream);
  const gain = audioContext.createGain();
  gain.gain.value = level; // Very low — just enough to hear yourself
  source.connect(gain);
  gain.connect(audioContext.destination);
  return { source, gain };
}
```

- User toggle: "Enable sidetone" in settings
- Volume slider: 0-30% range (higher causes feedback with speakers/open-back headphones)
- **Warning:** Sidetone only works well with closed-back headphones or IEMs. With speakers or open-back headphones, it will cause feedback. Display a warning when enabling.
- React Native: Use platform-specific audio route monitoring to implement natively

**Complexity:** Low  
**Dependencies:** MVP audio pipeline  
**Estimated effort:** 3-5 days

---

### 2.13 Headset Button PTT ✅ IMPLEMENTED

> **New feature** — critical for mobile users who need hardware PTT without a dedicated intercom belt pack.

**Description:**
Map the headset inline button (play/pause button on wired earbuds, or the equivalent on Bluetooth headsets) to Push-to-Talk.

**Rationale:**
Mobile users holding a phone while doing their job (camera op, stage hand) need a hardware button for PTT. The inline headset button is universally available on both wired and Bluetooth headsets.

**Implementation:**
- **Web:** Listen for `navigator.mediaSession` actions or keyboard `MediaPlayPause` event
- **React Native:** Use `react-native-headphone-detection` and media button event listeners
  - Android: Register `MediaButtonReceiver` / `MediaSession` callback
  - iOS: Use `MPRemoteCommandCenter` `.togglePlayPauseCommand`
- Map single-press to PTT toggle (latch mode) or hold-to-talk
- Double-press could map to All-Page or channel switch (configurable)

**Complexity:** Medium  
**Dependencies:** MVP mobile client  
**Estimated effort:** 1-2 weeks

---

### 2.14 Bandwidth Adaptation ✅ IMPLEMENTED

> **Moved UP from Tier 3.** Important for WiFi-heavy environments where bandwidth varies.

**Description:**
Dynamically adjust audio codec parameters based on detected network conditions:
- Lower bitrate on poor connections
- Adjust FEC (Forward Error Correction) level based on packet loss
- Optionally switch to narrowband Opus on very poor connections

**Rationale:**
WiFi quality varies across a church campus. A user in a far hallway may have poor signal. Rather than dropping audio entirely, adapting the codec keeps communication working at reduced quality.

**Implementation:**
- Monitor WebRTC stats (packet loss, jitter, RTT) — feeds from Connection Quality Indicators (1.11)
- Define quality tiers:
  | Tier | Bitrate | FEC | Bandwidth |
  |------|---------|-----|-----------|
  | Good | 32 kbps | Off | Wideband |
  | Fair | 24 kbps | On | Wideband |
  | Poor | 16 kbps | On | Narrowband |
- Use mediasoup's `producer.setMaxSpatialLayer()` or renegotiate codec parameters
- Log quality transitions for admin review

**Complexity:** Medium  
**Dependencies:** Connection Quality Indicators (1.11)  
**Estimated effort:** 1-2 weeks

---

## Priority Tier 3: Lower Priority (Nice-to-Have & Integrations)

These features add professional-grade capabilities and hardware integrations but are not essential for core intercom functionality.

---

### 3.1 Tally Integration (Video Switcher)

**Description:**
Display video switcher tally information on intercom clients. When a camera is "on program" (live), the corresponding user's client shows a red tally indicator. When on "preview," it shows green.

**Rationale:**
Camera operators need to know if they're live. In traditional setups, tally lights are on the camera. With CueCommX, the camera op's phone/tablet can show tally status. Unity Intercom sells a $660 "Tally License" for this feature. Supports iOS flashlight-as-tally.

**Supported Protocols:**
- Blackmagic ATEM (via ATEM network protocol)
- Ross Carbonite (via RossTalk protocol)
- OBS (via obs-websocket)
- TSL UMD v3.1/v5 (universal tally protocol)
- Generic GPIO input

**Implementation:**
- Tally integration module on the server
- Server connects to video switcher and receives tally state
- Maps tally sources to CueCommX users (admin configuration)
- Broadcasts tally state to relevant clients
- Client shows: 🔴 PROGRAM / 🟢 PREVIEW indicator
- Mobile: optionally flash device flashlight on program (Unity Intercom does this)

**Complexity:** High (per-protocol integration)  
**Dependencies:** MVP server  
**Estimated effort:** 2-4 weeks (per protocol)

---

### 3.2 Dante / AES67 Audio Bridge

**Description:**
Bridge CueCommX audio channels to/from a Dante or AES67 audio network. This allows CueCommX to integrate with professional audio infrastructure — for example, receiving a program audio mix from a Dante-enabled mixing console.

**Rationale:**
Most professional AV installations use Dante for audio networking. Bridging CueCommX to Dante lets it coexist with existing infrastructure. Unity Intercom supports Dante via their I/O license ($260).

**Implementation:**
- Use a Dante Virtual Soundcard or AES67 interface on the server
- Server captures audio from the sound card input and creates a CueCommX program feed
- Server outputs CueCommX channel audio to sound card outputs
- Mapping matrix: which Dante channels map to which CueCommX channels
- Requires server to have a compatible audio interface

**Complexity:** High  
**Dependencies:** Program audio feeds (2.1)  
**Estimated effort:** 3-4 weeks

---

### 3.3 External Intercom Bridging (Clear-Com, RTS 4-Wire)

**Description:**
Bridge CueCommX channels to traditional 4-wire intercom systems (Clear-Com, RTS). This allows CueCommX users to communicate with users on a legacy intercom system.

**Rationale:**
Many venues have existing wired intercom infrastructure. CueCommX can supplement (not replace) that infrastructure by bridging software clients to the existing system.

**Implementation:**
- Requires a 4-wire audio interface connected to the server (USB or Dante)
- Each 4-wire pair maps to a CueCommX channel
- Server mixes CueCommX channel audio to 4-wire output
- Server receives 4-wire input and distributes to CueCommX channel listeners
- Level matching and impedance considerations

**Complexity:** High  
**Dependencies:** Dante/AES67 bridge (3.2) or USB audio I/O  
**Estimated effort:** 2-3 weeks

---

### 3.4 GPIO Integration

**Description:**
Hardware input/output triggers via GPIO interfaces. Inputs can trigger actions (e.g., a physical button triggers talk). Outputs can signal states (e.g., an LED lights when a user is online).

**Rationale:**
Physical buttons and indicators are important in permanent installations. A wall-mounted button can serve as a PTT switch. An LED can indicate "director is paging." Unity Intercom offers "Online Status GPIO" for $260.

**Implementation:**
- Support USB GPIO devices (Advantech Adam, Phidgets, Arduino)
- Server-side GPIO module with configurable input/output mapping
- Input actions: PTT, call signal, group switch
- Output triggers: user online, channel active, tally
- Configuration via admin panel

**Complexity:** High  
**Dependencies:** MVP server  
**Estimated effort:** 3-4 weeks

---

### 3.5 StreamDeck / X-Keys Integration

**Description:**
Use Elgato StreamDeck or X-Keys panels as physical control surfaces for CueCommX. Buttons can be mapped to channels (talk/listen toggle), users (direct call), or system functions (all-page, mute).

**Rationale:**
Technical directors and production managers often use StreamDecks for show control. Integrating CueCommX lets them control intercom from the same panel they use for video switching and graphics.

**Implementation:**
- StreamDeck SDK integration (Node.js plugin or companion app)
- X-Keys HID integration via node-hid
- Button mapping configuration in admin panel
- Dynamic button icons showing channel status (talking, listening, call)
- LED color feedback matching channel colors

**Complexity:** Medium-High  
**Dependencies:** MVP channel system  
**Estimated effort:** 2-3 weeks per device type

---

### 3.6 OSC (Open Sound Control) Protocol

**Description:**
Expose CueCommX state and accept commands via OSC protocol. This enables integration with show control systems (QLab, ETC Eos, Bitfocus Companion, etc.).

**Rationale:**
OSC is the lingua franca of live production control. Integration with OSC lets CueCommX be automated as part of larger show control workflows.

**Implementation:**
- OSC server running on configurable port
- Outgoing OSC messages for state changes:
  - `/cuecommx/user/{id}/online` (0 or 1)
  - `/cuecommx/channel/{id}/active` (0 or 1)
  - `/cuecommx/user/{id}/talking` (0 or 1)
- Incoming OSC commands:
  - `/cuecommx/user/{id}/mute` (1 to mute, 0 to unmute)
  - `/cuecommx/channel/{id}/allpage` (trigger all-page)
- Uses `osc-js` or `node-osc` npm package

**Complexity:** Medium  
**Dependencies:** MVP server  
**Estimated effort:** 1-2 weeks

---

### 3.7 AES-256 Audio Encryption

> ⚠️ **Deprioritized.** WebRTC already provides mandatory DTLS-SRTP encryption (AES-128) on all audio streams. On a local network, this is more than sufficient. Additional encryption adds latency and complexity with minimal security benefit for a HoW use case. Only implement if a specific user requests it for a high-security environment.

**Description:**
Optional encryption of all audio streams beyond WebRTC's default DTLS-SRTP. Adds application-layer encryption for defense-in-depth.

**Implementation:**
- Note: WebRTC DTLS-SRTP is already AES-128 encrypted at the transport layer
- Additional layer: encrypt signaling WebSocket messages with AES-256
- Optional: use insertable streams API (WebRTC Encoded Transform) for E2E audio encryption
- Toggle in admin panel: "Enable enhanced encryption"

**Complexity:** Medium-High  
**Dependencies:** MVP audio pipeline  
**Estimated effort:** 2-3 weeks

---

### 3.8 Multi-Server Redundancy / Failover

> ⚠️ **Deprioritized.** This is enterprise-grade infrastructure that is overkill for the target market (10-30 user HoW deployments). The MVP's reconnection with state restoration handles the most common failure case (server restart). Only implement if CueCommX expands to broadcast or large-venue markets.

**Description:**
Run two CueCommX servers in active/standby configuration. If the primary server fails, clients automatically reconnect to the standby server.

**Implementation:**
- Two servers share configuration via SQLite replication or file sync
- Heartbeat between servers to detect failure
- Clients configured with both server addresses
- On primary failure, clients detect disconnection and reconnect to standby
- State synchronization between servers (user assignments, channel config)
- No audio state transfer (users must re-establish talk/listen)

**Complexity:** Very High  
**Dependencies:** All MVP components  
**Estimated effort:** 4-6 weeks

---

### 3.9 Audio Recording / Session Logging — **IMPLEMENTED**

**Description:**
Record audio from one or all channels for post-event review, training, or archival.

**Implementation (actual):**
- JSONL-based session logging service (`apps/server/src/recording/service.ts`) captures talk events with timestamps
- Admin API routes for start/stop recording per channel, list recordings, download, delete, prune old files
- Real-time `recording:state` WebSocket broadcast shows active recording indicator (● REC badge) on channel cards (web + mobile)
- Admin UI recording management panel with start/stop controls, file browser, and auto-prune configuration
- RecordingService with 17 unit tests covering start/stop, concurrent recordings, pruning, sanitization

---

### 3.10 ~~Bandwidth Adaptation~~ → Moved to Tier 2 (2.14)

---

### 3.11 Custom Notification Sounds — **IMPLEMENTED**

**Description:**
Configurable alert tones for different events.

**Implementation (actual):**
- Web: 11 notification event types (call, standby, go, allpage, chatMessage, connectionLost, connectionRestored, directCall, pttEngage, pttRelease, userOnline) with distinct tone patterns (beep, double, rising, falling, tick, steady)
- Per-event enable/disable with sensible defaults (PTT engage/release and userOnline off by default)
- Separate volume control (0-100) independent of intercom audio
- Settings persisted via web client preferences with full round-trip test coverage
- Notification settings UI card in web client with master enable toggle, volume slider, and per-event checkboxes
- 9 unit tests covering tone generation, notification enable/disable, and volume control

---

### 3.12 Mobile: Haptic Feedback Patterns — **IMPLEMENTED**

**Description:**
Custom vibration patterns on mobile devices for different events.

**Implementation (actual):**
- 5 distinct haptic patterns via expo-haptics:
  - Call signal → Warning notification (attention-getting)
  - All-Page → Double heavy impact with 100ms delay (urgent/distinct)
  - Direct call → Success notification (positive attention)
  - Connection lost → Error notification (alarm)
  - Chat message → Light impact (subtle)
- Existing PTT haptics preserved: Heavy impact on engage, Light on release, Selection for mode/listen toggles
- All haptics dispatched via `queueHapticFeedback()` with InteractionManager for non-blocking execution
- Wired to allpage:active, signal:incoming, direct:incoming, and connection lost events

---

### 3.13 Mobile: Lock Screen Widget / Controls

**Description:**
Control intercom from the lock screen or notification shade:
- iOS: Live Activity showing current channel and talk button
- Android: Persistent notification with talk/listen controls
- Both: Media session integration for headset button control (headset button = PTT)

**Rationale:**
Users shouldn't have to unlock their phone and open the app to talk. Quick access from lock screen or physical headset buttons dramatically improves usability.

**Implementation:**
- iOS: WidgetKit + Live Activities
- Android: Foreground service with custom notification layout
- Both: Media session integration (headset button maps to PTT)
- Requires background audio to already be working

**Complexity:** High  
**Dependencies:** MVP mobile client  
**Estimated effort:** 2-3 weeks

---

### 3.14 Landscape Mode & Tablet Layout — **IMPLEMENTED**

**Description:**
Optimized layouts for landscape orientation and tablet-sized screens.

**Implementation (actual):**
- Mobile: `useWindowDimensions()` detects landscape (width > height) and tablet (min dimension ≥ 600px)
- Channel cards wrap in a flex-row grid: 2 columns in landscape, 3 columns on tablets
- Web: Already responsive via Tailwind CSS `auto-fit` grid and `xl:` breakpoint layouts — no changes needed

---

### 3.15 MIDI Control Surface Support

**Description:**
Use MIDI controllers (faders, buttons, knobs) as physical control surfaces for CueCommX. MIDI faders control channel volumes, MIDI buttons control talk/listen.

**Rationale:**
Audio engineers often have MIDI controllers at their mix position. Using existing hardware for intercom control integrates into their workflow.

**Implementation:**
- Web MIDI API for browser-based MIDI access
- MIDI learn mode: press a MIDI button, then assign a CueCommX function
- Fader → channel volume mapping
- Button → talk/listen/call mapping
- Note on/off → PTT

**Complexity:** Medium  
**Dependencies:** MVP web client  
**Estimated effort:** 2 weeks

---

### 3.16 Ambient Listening / Pass-Through Mode

**Description:**
Mix environmental audio (from the device's microphone) into the user's headset alongside intercom audio. Allows headset-wearing users to hear their physical surroundings.

**Rationale:**
Users wearing isolating headsets (common in AV) can't hear what's happening around them. Pass-through mode mixes ambient sound into the headset so they maintain situational awareness.

**Implementation:**
- Open a second microphone stream (or use the same mic with split processing)
- Route to local audio output only (not transmitted to intercom)
- Adjustable ambient level
- Quick toggle on/off

**Complexity:** Medium  
**Dependencies:** MVP audio pipeline  
**Estimated effort:** 1-2 weeks

---

### 3.17 Multi-Language UI Support (i18n)

**Description:**
Translate the UI into multiple languages using i18n framework.

**Rationale:**
Houses of worship serve diverse communities. A Spanish, Korean, or Portuguese-speaking volunteer should be able to use CueCommX in their language.

**Implementation:**
- Use `react-i18next` for all UI strings
- Extract all strings to JSON translation files
- Start with English, Spanish, Portuguese, Korean
- Language selector in user settings
- Community contribution workflow for new languages

**Complexity:** Medium  
**Dependencies:** All UI components  
**Estimated effort:** 2-3 weeks (framework + initial translations)

---

### 3.18 Text Chat / Messaging — **IMPLEMENTED**

> **Moved DOWN from Tier 2.** Professional intercom systems are audio-first and do not include text chat.

**Description:**
Per-channel text messaging alongside audio communication.

**Implementation (actual):**
- Protocol: `chat:send` (client→server), `chat:message` (server→client), `chat:history` (server→client on connect) with ChatMessagePayload schema
- Server: In-memory per-channel message store (capped at 100 messages per channel), history sent on session connect
- Core: `sendChatMessage()` method on CueCommXRealtimeClient
- Web: Chat panel with per-channel message log, unread count badges on channel cards, message input with send button
- Mobile: Full-screen chat modal via React Native Modal with FlatList message display, unread badges, keyboard-aware input
- Event logging: chat:message events logged to server event log
- Tests: Protocol schema validation tests for all chat message types

---

## Feature Dependency Graph

```
MVP (Foundation)
│
├── Tier 1 — High Priority
│   ├── 1.9  Noise Suppression (free with WebRTC — do this first)
│   ├── 1.13 Preflight Audio Test
│   ├── 1.11 Connection Quality Indicators
│   ├── 1.7  Call Signaling
│   ├── 1.1  VOX Mode
│   ├── 1.2  All-Page
│   ├── 1.6  Force-Mute & Unlatch (advanced — basic in MVP)
│   ├── 1.3  Direct Communication
│   ├── 1.8  Operator Role (advanced permissions — basic in MVP)
│   ├── 1.4  Groups
│   │   └── 1.5  Global/Sticky Channels
│   ├── 1.10 Program Audio Feeds
│   │   └── 1.12 IFB (requires program feeds)
│   │       └── 2.11 Confidence Monitoring (requires program feeds)
│   └── (1.11 also feeds into 2.14 Bandwidth Adaptation)
│
├── Tier 2 — Medium Priority
│   ├── 2.3  User Profiles
│   ├── 2.4  Audio Ducking
│   ├── 2.6  Enhanced Metering
│   ├── 2.7  Keyboard Shortcuts
│   ├── 2.8  Split-Ear Audio
│   ├── 2.10 Event Logging
│   ├── 2.12 Sidetone
│   ├── 2.13 Headset Button PTT
│   └── 2.14 Bandwidth Adaptation (requires 1.11 Connection Quality)
│
└── Tier 3 — Lower Priority
    ├── 3.1  Tally Integration
    ├── 3.2  Dante/AES67 Bridge (requires 1.10 Program Feeds)
    │   └── 3.3  External Intercom Bridge (requires 3.2)
    ├── 3.4  GPIO
    ├── 3.5  StreamDeck / X-Keys
    ├── 3.6  OSC Protocol
    ├── 3.9  Recording
    ├── 3.11 Custom Notifications (requires 1.7 Call Signaling)
    ├── 3.12 Haptic Feedback
    ├── 3.13 Lock Screen Controls
    ├── 3.14 Landscape/Tablet Layout
    ├── 3.15 MIDI Control
    ├── 3.16 Ambient Listening
    ├── 3.17 Multi-Language (i18n)
    ├── 3.18 Text Chat
    ├── 3.7  AES-256 Encryption (deprioritized — WebRTC already encrypts)
    └── 3.8  Multi-Server Redundancy (deprioritized — overkill for HoW)
```

---

## Recommended Implementation Sequence

After MVP is complete, implement in this order for maximum user value:

### Phase A: Quick Wins & Audio Quality (1-2 weeks)
1. **1.9 Noise Suppression & AGC** — Nearly free with WebRTC built-in constraints; toggle UI
2. **1.13 Preflight Audio Test** — Critical for volunteer onboarding
3. **1.11 Connection Quality Indicators** — Essential for WiFi troubleshooting

### Phase B: Core Production Features (4-6 weeks)
4. **1.7 Call Signaling** — Fundamental production tool (standby/go cues)
5. **1.6 Force-Mute & Unlatch** — Advanced admin controls beyond MVP basics
6. **1.2 All-Page** — Director essential
7. **1.1 VOX Mode** — Hands-free operation
8. **1.3 Direct Communication** — Private conversations
9. **1.8 Operator Role** — Full permission matrix

### Phase C: Program Audio & Professional Monitoring (3-4 weeks)
10. **1.10 Program Audio Feeds** — #1 feature request for HoW
11. **1.12 IFB** — Director-to-talent communication
12. **2.12 Sidetone** — Local audio bypass for headphone users

### Phase D: User Experience & Power Features (3-4 weeks)
13. **1.4 Groups** + **1.5 Sticky Channels** — UI simplification
14. **2.3 User Profiles** — Settings persistence
15. **2.7 Keyboard Shortcuts** — Power users
16. **2.13 Headset Button PTT** — Hardware PTT for mobile
17. **2.6 Enhanced Metering** — Visual feedback

### Phase E: Advanced Audio (2-3 weeks)
18. **2.4 Audio Ducking** — Priority channel management
19. **2.8 Split-Ear Audio** — Professional stereo monitoring
20. **2.14 Bandwidth Adaptation** — Reliability on poor WiFi
21. **2.11 Confidence Monitoring** — Worship leader feeds

### Phase F: Operational Tools (2-3 weeks)
22. **2.10 Event Logging** — Audit trail
23. **3.6 OSC Protocol** — Show control integration
24. **3.5 StreamDeck** — Physical control surface

### Phase G: Integrations & Polish (ongoing)
25. **3.1 Tally Integration** — Video production
26. **3.11 Custom Notifications** — Audio polish
27. **3.12 Haptic Feedback** — Mobile polish
28. **3.13 Lock Screen Controls** — Mobile usability
29. **3.14 Landscape/Tablet Layout** — Tablet optimization
30. **3.15 MIDI Control** — Audio engineers
31. **3.16 Ambient Listening** — Safety feature
32. **3.17 Multi-Language** — Accessibility
33. **3.18 Text Chat** — Supplementary communication
34. **3.9 Recording** — Archival

### Phase H: Specialized / On-Demand
35. **3.2 Dante Bridge** — Pro audio integration
36. **3.3 External Intercom Bridge** — Legacy system integration
37. **3.4 GPIO** — Hardware I/O for permanent installations
38. **3.7 AES-256 Encryption** — Only if requested by specific users
39. **3.8 Multi-Server Redundancy** — Only if market expands to broadcast/enterprise
