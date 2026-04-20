import { describe, expect, it } from "vitest";

import {
  clearStoredSession,
  DEFAULT_AUDIO_PROCESSING,
  DEFAULT_DUCKING_SETTINGS,
  DEFAULT_NOTIFICATION_PREFS,
  DEFAULT_WEB_CLIENT_PREFERENCES,
  hasStoredPreferredListenChannelIds,
  loadStoredSession,
  loadWebClientPreferences,
  parseWebClientPreferences,
  saveStoredSession,
  saveWebClientPreferences,
  WEB_CLIENT_PREFERENCES_KEY,
  WEB_CLIENT_SESSION_KEY,
} from "./preferences.js";

describe("parseWebClientPreferences", () => {
  it("returns defaults when storage is empty or invalid", () => {
    expect(parseWebClientPreferences(null)).toEqual(DEFAULT_WEB_CLIENT_PREFERENCES);
    expect(parseWebClientPreferences("{oops")).toEqual(DEFAULT_WEB_CLIENT_PREFERENCES);
  });

  it("keeps only valid persisted values and clamps volumes", () => {
    expect(
      parseWebClientPreferences(
        JSON.stringify({
          channelVolumes: { "ch-1": 35, "ch-2": 180, bad: "nope" },
          latchModeChannelIds: ["ch-1", "", 2],
          masterVolume: 140,
          preferredListenChannelIds: ["ch-1", null, "ch-2"],
          selectedInputDeviceId: "mic-2",
        }),
      ),
    ).toEqual({
      audioProcessing: { ...DEFAULT_AUDIO_PROCESSING },
      channelPans: {},
      channelVolumes: { "ch-1": 35, "ch-2": 100 },
      ducking: { ...DEFAULT_DUCKING_SETTINGS },
      latchModeChannelIds: ["ch-1"],
      masterVolume: 100,
      notifications: { ...DEFAULT_NOTIFICATION_PREFS },
      preferredListenChannelIds: ["ch-1", "ch-2"],
      selectedInputDeviceId: "mic-2",
      sidetone: { enabled: false, level: 15 },
      voxModeChannelIds: [],
      voxSettings: { holdTimeMs: 500, thresholdDb: -40 },
    });
  });

  it("parses audioProcessing with defaults for missing boolean fields", () => {
    expect(
      parseWebClientPreferences(JSON.stringify({ audioProcessing: { noiseSuppression: false } })),
    ).toMatchObject({
      audioProcessing: { autoGainControl: true, echoCancellation: true, noiseSuppression: false },
    });
  });

  it("defaults audioProcessing when field is absent or invalid", () => {
    expect(parseWebClientPreferences(JSON.stringify({}))).toMatchObject({
      audioProcessing: { ...DEFAULT_AUDIO_PROCESSING },
    });
    expect(
      parseWebClientPreferences(JSON.stringify({ audioProcessing: "bad" })),
    ).toMatchObject({
      audioProcessing: { ...DEFAULT_AUDIO_PROCESSING },
    });
  });
});

describe("hasStoredPreferredListenChannelIds", () => {
  it("detects whether listen preferences were explicitly saved", () => {
    expect(hasStoredPreferredListenChannelIds(null)).toBe(false);
    expect(hasStoredPreferredListenChannelIds(JSON.stringify({}))).toBe(false);
    expect(
      hasStoredPreferredListenChannelIds(JSON.stringify({ preferredListenChannelIds: [] })),
    ).toBe(true);
  });
});

describe("load/saveWebClientPreferences", () => {
  it("round-trips preferences through storage", () => {
    const storage = new Map<string, string>();

    saveWebClientPreferences(
      {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => {
          storage.set(key, value);
        },
      },
      {
        audioProcessing: { autoGainControl: false, echoCancellation: true, noiseSuppression: true },
        channelPans: {},
        channelVolumes: { "ch-1": 55 },
        ducking: { enabled: true, level: 30 },
        latchModeChannelIds: ["ch-1"],
        masterVolume: 75,
        notifications: { ...DEFAULT_NOTIFICATION_PREFS },
        preferredListenChannelIds: ["ch-1"],
        selectedInputDeviceId: "usb-mic",
        sidetone: { enabled: false, level: 15 },
        voxModeChannelIds: [],
        voxSettings: { holdTimeMs: 500, thresholdDb: -40 },
      },
    );

    expect(storage.has(WEB_CLIENT_PREFERENCES_KEY)).toBe(true);
    expect(
      loadWebClientPreferences({
        getItem: (key) => storage.get(key) ?? null,
        setItem: () => undefined,
      }),
    ).toEqual({
      audioProcessing: { autoGainControl: false, echoCancellation: true, noiseSuppression: true },
      channelPans: {},
      channelVolumes: { "ch-1": 55 },
      ducking: { enabled: true, level: 30 },
      latchModeChannelIds: ["ch-1"],
      masterVolume: 75,
      notifications: { ...DEFAULT_NOTIFICATION_PREFS },
      preferredListenChannelIds: ["ch-1"],
      selectedInputDeviceId: "usb-mic",
      sidetone: { enabled: false, level: 15 },
      voxModeChannelIds: [],
      voxSettings: { holdTimeMs: 500, thresholdDb: -40 },
    });
  });
});

describe("stored session persistence", () => {
  it("round-trips session token and username through storage", () => {
    const storage = new Map<string, string>();
    const storageLike = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };

    expect(loadStoredSession(storageLike)).toBeUndefined();

    saveStoredSession(storageLike, {
      sessionToken: "sess-abc-123",
      username: "Stage",
    });

    expect(storage.has(WEB_CLIENT_SESSION_KEY)).toBe(true);

    const restored = loadStoredSession(storageLike);

    expect(restored).toEqual({
      sessionToken: "sess-abc-123",
      username: "Stage",
    });

    clearStoredSession(storageLike);

    expect(loadStoredSession(storageLike)).toBeUndefined();
  });

  it("returns undefined for invalid or empty stored session data", () => {
    const storageLike = {
      getItem: () => null,
      setItem: () => undefined,
    };

    expect(loadStoredSession(storageLike)).toBeUndefined();
    expect(loadStoredSession(undefined)).toBeUndefined();

    const badStorage = {
      getItem: () => "{bad json",
      setItem: () => undefined,
    };

    expect(loadStoredSession(badStorage)).toBeUndefined();
  });
});
