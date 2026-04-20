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

export interface SidetoneSettings {
  enabled: boolean;
  level: number;
}

export const DEFAULT_SIDETONE_SETTINGS: SidetoneSettings = {
  enabled: false,
  level: 15,
};

export interface DuckingSettings {
  enabled: boolean;
  level: number;
}

export const DEFAULT_DUCKING_SETTINGS: DuckingSettings = {
  enabled: true,
  level: 30,
};

export interface WebClientPreferences {
  activeGroupId?: string;
  audioProcessing: AudioProcessingPreferences;
  channelPans: Record<string, number>;
  channelVolumes: Record<string, number>;
  ducking: DuckingSettings;
  latchModeChannelIds: string[];
  masterVolume: number;
  preferredListenChannelIds: string[];
  selectedInputDeviceId: string;
  sidetone: SidetoneSettings;
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
  activeGroupId: undefined,
  audioProcessing: { ...DEFAULT_AUDIO_PROCESSING },
  channelPans: {},
  channelVolumes: {},
  ducking: { ...DEFAULT_DUCKING_SETTINGS },
  latchModeChannelIds: [],
  masterVolume: 100,
  preferredListenChannelIds: [],
  selectedInputDeviceId: "",
  sidetone: { ...DEFAULT_SIDETONE_SETTINGS },
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

function toPanMap(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
      .map(([channelId, pan]) => [channelId, Math.max(-1, Math.min(1, pan))]),
  );
}

function toSidetoneSettings(value: unknown): SidetoneSettings {
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_SIDETONE_SETTINGS };
  }

  const obj = value as Record<string, unknown>;

  return {
    enabled: typeof obj.enabled === "boolean" ? obj.enabled : DEFAULT_SIDETONE_SETTINGS.enabled,
    level:
      typeof obj.level === "number" && Number.isFinite(obj.level)
        ? Math.max(0, Math.min(30, Math.round(obj.level)))
        : DEFAULT_SIDETONE_SETTINGS.level,
  };
}

function toDuckingSettings(value: unknown): DuckingSettings {
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_DUCKING_SETTINGS };
  }

  const obj = value as Record<string, unknown>;

  return {
    enabled: typeof obj.enabled === "boolean" ? obj.enabled : DEFAULT_DUCKING_SETTINGS.enabled,
    level:
      typeof obj.level === "number" && Number.isFinite(obj.level)
        ? Math.max(10, Math.min(80, Math.round(obj.level)))
        : DEFAULT_DUCKING_SETTINGS.level,
  };
}

export function parseWebClientPreferences(input: string | null | undefined): WebClientPreferences {
  if (!input) {
    return DEFAULT_WEB_CLIENT_PREFERENCES;
  }

  try {
    const parsed = JSON.parse(input) as {
      activeGroupId?: unknown;
      audioProcessing?: unknown;
      channelPans?: unknown;
      channelVolumes?: unknown;
      ducking?: unknown;
      latchModeChannelIds?: unknown;
      masterVolume?: unknown;
      preferredListenChannelIds?: unknown;
      selectedInputDeviceId?: unknown;
      sidetone?: unknown;
      voxModeChannelIds?: unknown;
      voxSettings?: unknown;
    };

    return {
      activeGroupId:
        typeof parsed.activeGroupId === "string" && parsed.activeGroupId.trim()
          ? parsed.activeGroupId
          : undefined,
      audioProcessing: toAudioProcessing(parsed.audioProcessing),
      channelPans: toPanMap(parsed.channelPans),
      channelVolumes: toVolumeMap(parsed.channelVolumes),
      ducking: toDuckingSettings(parsed.ducking),
      latchModeChannelIds: toStringArray(parsed.latchModeChannelIds),
      masterVolume:
        typeof parsed.masterVolume === "number" && Number.isFinite(parsed.masterVolume)
          ? clampPercent(parsed.masterVolume)
          : DEFAULT_WEB_CLIENT_PREFERENCES.masterVolume,
      preferredListenChannelIds: toStringArray(parsed.preferredListenChannelIds),
      selectedInputDeviceId:
        typeof parsed.selectedInputDeviceId === "string" ? parsed.selectedInputDeviceId : "",
      sidetone: toSidetoneSettings(parsed.sidetone),
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
