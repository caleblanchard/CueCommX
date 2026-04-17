export interface AudioProcessingPreferences {
  autoGainControl: boolean;
  echoCancellation: boolean;
  noiseSuppression: boolean;
}

export const DEFAULT_AUDIO_PROCESSING: AudioProcessingPreferences = {
  autoGainControl: true,
  echoCancellation: true,
  noiseSuppression: true,
};

export interface VoxSettings {
  holdTimeMs: number;
  thresholdDb: number;
}

export const DEFAULT_VOX_SETTINGS: VoxSettings = {
  holdTimeMs: 500,
  thresholdDb: -40,
};

export interface WebClientPreferences {
  audioProcessing: AudioProcessingPreferences;
  channelVolumes: Record<string, number>;
  latchModeChannelIds: string[];
  masterVolume: number;
  preferredListenChannelIds: string[];
  selectedInputDeviceId: string;
  voxModeChannelIds: string[];
  voxSettings: VoxSettings;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const WEB_CLIENT_PREFERENCES_KEY = "cuecommx.web-client.preferences";
export const WEB_CLIENT_SESSION_KEY = "cuecommx.web-client.session";

export interface StoredSession {
  sessionToken: string;
  username: string;
}

export const DEFAULT_WEB_CLIENT_PREFERENCES: WebClientPreferences = {
  audioProcessing: { ...DEFAULT_AUDIO_PROCESSING },
  channelVolumes: {},
  latchModeChannelIds: [],
  masterVolume: 100,
  preferredListenChannelIds: [],
  selectedInputDeviceId: "",
  voxModeChannelIds: [],
  voxSettings: { ...DEFAULT_VOX_SETTINGS },
};

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function toVolumeMap(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
      .map(([channelId, volume]) => [channelId, clampPercent(volume)]),
  );
}

function toAudioProcessing(value: unknown): AudioProcessingPreferences {
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_AUDIO_PROCESSING };
  }

  const obj = value as Record<string, unknown>;

  return {
    autoGainControl:
      typeof obj.autoGainControl === "boolean" ? obj.autoGainControl : DEFAULT_AUDIO_PROCESSING.autoGainControl,
    echoCancellation:
      typeof obj.echoCancellation === "boolean" ? obj.echoCancellation : DEFAULT_AUDIO_PROCESSING.echoCancellation,
    noiseSuppression:
      typeof obj.noiseSuppression === "boolean" ? obj.noiseSuppression : DEFAULT_AUDIO_PROCESSING.noiseSuppression,
  };
}

function toVoxSettings(value: unknown): VoxSettings {
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_VOX_SETTINGS };
  }

  const obj = value as Record<string, unknown>;

  return {
    holdTimeMs:
      typeof obj.holdTimeMs === "number" && Number.isFinite(obj.holdTimeMs)
        ? Math.max(200, Math.min(2000, Math.round(obj.holdTimeMs)))
        : DEFAULT_VOX_SETTINGS.holdTimeMs,
    thresholdDb:
      typeof obj.thresholdDb === "number" && Number.isFinite(obj.thresholdDb)
        ? Math.max(-60, Math.min(-10, obj.thresholdDb))
        : DEFAULT_VOX_SETTINGS.thresholdDb,
  };
}

export function parseWebClientPreferences(input: string | null | undefined): WebClientPreferences {
  if (!input) {
    return DEFAULT_WEB_CLIENT_PREFERENCES;
  }

  try {
    const parsed = JSON.parse(input) as {
      audioProcessing?: unknown;
      channelVolumes?: unknown;
      latchModeChannelIds?: unknown;
      masterVolume?: unknown;
      preferredListenChannelIds?: unknown;
      selectedInputDeviceId?: unknown;
      voxModeChannelIds?: unknown;
      voxSettings?: unknown;
    };

    return {
      audioProcessing: toAudioProcessing(parsed.audioProcessing),
      channelVolumes: toVolumeMap(parsed.channelVolumes),
      latchModeChannelIds: toStringArray(parsed.latchModeChannelIds),
      masterVolume:
        typeof parsed.masterVolume === "number" && Number.isFinite(parsed.masterVolume)
          ? clampPercent(parsed.masterVolume)
          : DEFAULT_WEB_CLIENT_PREFERENCES.masterVolume,
      preferredListenChannelIds: toStringArray(parsed.preferredListenChannelIds),
      selectedInputDeviceId:
        typeof parsed.selectedInputDeviceId === "string" ? parsed.selectedInputDeviceId : "",
      voxModeChannelIds: toStringArray(parsed.voxModeChannelIds),
      voxSettings: toVoxSettings(parsed.voxSettings),
    };
  } catch {
    return DEFAULT_WEB_CLIENT_PREFERENCES;
  }
}

export function hasStoredPreferredListenChannelIds(input: string | null | undefined): boolean {
  if (!input) {
    return false;
  }

  try {
    const parsed = JSON.parse(input) as {
      preferredListenChannelIds?: unknown;
    };

    return Array.isArray(parsed.preferredListenChannelIds);
  } catch {
    return false;
  }
}

export function loadWebClientPreferences(
  storage: StorageLike | undefined,
): WebClientPreferences {
  if (!storage) {
    return DEFAULT_WEB_CLIENT_PREFERENCES;
  }

  return parseWebClientPreferences(storage.getItem(WEB_CLIENT_PREFERENCES_KEY));
}

export function saveWebClientPreferences(
  storage: StorageLike | undefined,
  preferences: WebClientPreferences,
): void {
  if (!storage) {
    return;
  }

  storage.setItem(WEB_CLIENT_PREFERENCES_KEY, JSON.stringify(preferences));
}

export function loadStoredSession(storage: StorageLike | undefined): StoredSession | undefined {
  if (!storage) {
    return undefined;
  }

  try {
    const raw = storage.getItem(WEB_CLIENT_SESSION_KEY);

    if (!raw) {
      return undefined;
    }

    const parsed = JSON.parse(raw) as { sessionToken?: unknown; username?: unknown };

    if (typeof parsed.sessionToken !== "string" || !parsed.sessionToken.trim()) {
      return undefined;
    }

    return {
      sessionToken: parsed.sessionToken,
      username: typeof parsed.username === "string" ? parsed.username : "",
    };
  } catch {
    return undefined;
  }
}

export function saveStoredSession(
  storage: StorageLike | undefined,
  session: StoredSession,
): void {
  if (!storage) {
    return;
  }

  storage.setItem(WEB_CLIENT_SESSION_KEY, JSON.stringify(session));
}

export function clearStoredSession(storage: StorageLike | undefined): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(WEB_CLIENT_SESSION_KEY, "");
  } catch {
    // Ignore storage errors during cleanup
  }
}
