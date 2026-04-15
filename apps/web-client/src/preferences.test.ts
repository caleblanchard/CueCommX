import { describe, expect, it } from "vitest";

import {
  DEFAULT_WEB_CLIENT_PREFERENCES,
  hasStoredPreferredListenChannelIds,
  WEB_CLIENT_PREFERENCES_KEY,
  loadWebClientPreferences,
  parseWebClientPreferences,
  saveWebClientPreferences,
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
      channelVolumes: { "ch-1": 35, "ch-2": 100 },
      latchModeChannelIds: ["ch-1"],
      masterVolume: 100,
      preferredListenChannelIds: ["ch-1", "ch-2"],
      selectedInputDeviceId: "mic-2",
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
        channelVolumes: { "ch-1": 55 },
        latchModeChannelIds: ["ch-1"],
        masterVolume: 75,
        preferredListenChannelIds: ["ch-1"],
        selectedInputDeviceId: "usb-mic",
      },
    );

    expect(storage.has(WEB_CLIENT_PREFERENCES_KEY)).toBe(true);
    expect(
      loadWebClientPreferences({
        getItem: (key) => storage.get(key) ?? null,
        setItem: () => undefined,
      }),
    ).toEqual({
      channelVolumes: { "ch-1": 55 },
      latchModeChannelIds: ["ch-1"],
      masterVolume: 75,
      preferredListenChannelIds: ["ch-1"],
      selectedInputDeviceId: "usb-mic",
    });
  });
});
