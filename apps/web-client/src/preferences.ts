export interface WebClientPreferences {
  channelVolumes: Record<string, number>;
  latchModeChannelIds: string[];
  masterVolume: number;
  preferredListenChannelIds: string[];
  selectedInputDeviceId: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const WEB_CLIENT_PREFERENCES_KEY = "cuecommx.web-client.preferences";

export const DEFAULT_WEB_CLIENT_PREFERENCES: WebClientPreferences = {
  channelVolumes: {},
  latchModeChannelIds: [],
  masterVolume: 100,
  preferredListenChannelIds: [],
  selectedInputDeviceId: "",
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

export function parseWebClientPreferences(input: string | null | undefined): WebClientPreferences {
  if (!input) {
    return DEFAULT_WEB_CLIENT_PREFERENCES;
  }

  try {
    const parsed = JSON.parse(input) as {
      channelVolumes?: unknown;
      latchModeChannelIds?: unknown;
      masterVolume?: unknown;
      preferredListenChannelIds?: unknown;
      selectedInputDeviceId?: unknown;
    };

    return {
      channelVolumes: toVolumeMap(parsed.channelVolumes),
      latchModeChannelIds: toStringArray(parsed.latchModeChannelIds),
      masterVolume:
        typeof parsed.masterVolume === "number" && Number.isFinite(parsed.masterVolume)
          ? clampPercent(parsed.masterVolume)
          : DEFAULT_WEB_CLIENT_PREFERENCES.masterVolume,
      preferredListenChannelIds: toStringArray(parsed.preferredListenChannelIds),
      selectedInputDeviceId:
        typeof parsed.selectedInputDeviceId === "string" ? parsed.selectedInputDeviceId : "",
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
