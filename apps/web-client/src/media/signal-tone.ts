let sharedAudioContext: AudioContext | undefined;

function getAudioContext(): AudioContext {
  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new AudioContext();
  }

  return sharedAudioContext;
}

/** @internal Test-only reset — clears the cached AudioContext so tests get a fresh mock. */
export function _resetAudioContextForTesting(): void {
  sharedAudioContext = undefined;
}

export type SignalToneType = "call" | "standby" | "go";

export type NotificationEvent =
  | "allpage"
  | "call"
  | "chatMessage"
  | "connectionLost"
  | "connectionRestored"
  | "directCall"
  | "go"
  | "pttEngage"
  | "pttRelease"
  | "standby"
  | "userOnline";

interface ToneConfig {
  durationMs: number;
  frequency: number;
  pattern: "beep" | "double" | "rising" | "falling" | "tick" | "steady";
  waveform: OscillatorType;
}

const NOTIFICATION_TONES: Record<NotificationEvent, ToneConfig> = {
  call: { frequency: 1000, durationMs: 800, pattern: "double", waveform: "sine" },
  standby: { frequency: 660, durationMs: 600, pattern: "steady", waveform: "sine" },
  go: { frequency: 880, durationMs: 400, pattern: "beep", waveform: "square" },
  allpage: { frequency: 1200, durationMs: 500, pattern: "rising", waveform: "sine" },
  chatMessage: { frequency: 1400, durationMs: 150, pattern: "tick", waveform: "sine" },
  connectionLost: { frequency: 400, durationMs: 600, pattern: "falling", waveform: "sine" },
  connectionRestored: { frequency: 600, durationMs: 400, pattern: "rising", waveform: "sine" },
  directCall: { frequency: 900, durationMs: 1000, pattern: "double", waveform: "sine" },
  pttEngage: { frequency: 1800, durationMs: 60, pattern: "tick", waveform: "sine" },
  pttRelease: { frequency: 1400, durationMs: 60, pattern: "tick", waveform: "sine" },
  userOnline: { frequency: 700, durationMs: 200, pattern: "rising", waveform: "sine" },
};

export interface NotificationSoundSettings {
  enabled: boolean;
  enabledEvents: Record<NotificationEvent, boolean>;
  volume: number; // 0-100
}

export const DEFAULT_NOTIFICATION_SOUND_SETTINGS: NotificationSoundSettings = {
  enabled: true,
  enabledEvents: {
    allpage: true,
    call: true,
    chatMessage: true,
    connectionLost: true,
    connectionRestored: true,
    directCall: true,
    go: true,
    pttEngage: false,
    pttRelease: false,
    standby: true,
    userOnline: false,
  },
  volume: 50,
};

let currentSettings: NotificationSoundSettings = { ...DEFAULT_NOTIFICATION_SOUND_SETTINGS };

export function setNotificationSoundSettings(settings: NotificationSoundSettings): void {
  currentSettings = settings;
}

export function getNotificationSoundSettings(): NotificationSoundSettings {
  return currentSettings;
}

function playTone(config: ToneConfig, volumeOverride?: number): void {
  const ctx = getAudioContext();

  if (ctx.state === "suspended") {
    void ctx.resume();
  }

  const gain = (volumeOverride ?? currentSettings.volume) / 100 * 0.4;
  const gainNode = ctx.createGain();
  gainNode.connect(ctx.destination);
  gainNode.gain.setValueAtTime(gain, ctx.currentTime);

  const durationSec = config.durationMs / 1000;

  if (config.pattern === "double") {
    const osc1 = ctx.createOscillator();
    osc1.type = config.waveform;
    osc1.frequency.setValueAtTime(config.frequency, ctx.currentTime);
    osc1.connect(gainNode);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.15);

    const osc2 = ctx.createOscillator();
    osc2.type = config.waveform;
    osc2.frequency.setValueAtTime(config.frequency, ctx.currentTime);
    osc2.connect(gainNode);
    osc2.start(ctx.currentTime + 0.25);
    osc2.stop(ctx.currentTime + 0.4);
    gainNode.gain.setValueAtTime(0, ctx.currentTime + 0.45);
  } else if (config.pattern === "steady") {
    const osc = ctx.createOscillator();
    osc.type = config.waveform;
    osc.frequency.setValueAtTime(config.frequency, ctx.currentTime);
    osc.connect(gainNode);
    osc.start(ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + durationSec);
    osc.stop(ctx.currentTime + durationSec + 0.05);
  } else if (config.pattern === "rising") {
    const osc = ctx.createOscillator();
    osc.type = config.waveform;
    osc.frequency.setValueAtTime(config.frequency * 0.8, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(config.frequency * 1.2, ctx.currentTime + durationSec);
    osc.connect(gainNode);
    osc.start(ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + durationSec);
    osc.stop(ctx.currentTime + durationSec + 0.05);
  } else if (config.pattern === "falling") {
    const osc = ctx.createOscillator();
    osc.type = config.waveform;
    osc.frequency.setValueAtTime(config.frequency * 1.2, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(config.frequency * 0.6, ctx.currentTime + durationSec);
    osc.connect(gainNode);
    osc.start(ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + durationSec);
    osc.stop(ctx.currentTime + durationSec + 0.05);
  } else if (config.pattern === "tick") {
    const osc = ctx.createOscillator();
    osc.type = config.waveform;
    osc.frequency.setValueAtTime(config.frequency, ctx.currentTime);
    osc.connect(gainNode);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + durationSec);
    gainNode.gain.setValueAtTime(0, ctx.currentTime + durationSec + 0.01);
  } else {
    const osc = ctx.createOscillator();
    osc.type = config.waveform;
    osc.frequency.setValueAtTime(config.frequency, ctx.currentTime);
    osc.connect(gainNode);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + durationSec);
    gainNode.gain.setValueAtTime(0, ctx.currentTime + durationSec + 0.01);
  }
}

export function playNotificationSound(event: NotificationEvent): void {
  if (!currentSettings.enabled || !currentSettings.enabledEvents[event]) {
    return;
  }

  const config = NOTIFICATION_TONES[event];
  playTone(config);
}

/** @deprecated Use playNotificationSound instead */
export function playSignalTone(type: SignalToneType): void {
  playNotificationSound(type);
}
