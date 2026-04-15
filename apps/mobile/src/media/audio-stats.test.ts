import { describe, expect, it } from "vitest";

import { extractAudioLevelFromStats } from "./audio-stats.js";

describe("extractAudioLevelFromStats", () => {
  it("reads the loudest audioLevel from a Map-based stats report", () => {
    const stats = new Map<string, Record<string, unknown>>([
      ["one", { type: "track", audioLevel: 0.24 }],
      ["two", { type: "media-source", audioLevel: 0.61 }],
    ]);

    expect(extractAudioLevelFromStats(stats)).toBe(0.61);
  });

  it("accepts plain-object stats payloads and clamps string values", () => {
    const stats = {
      first: { audioLevel: "0.8" },
      second: { audioLevel: "1.4" },
    };

    expect(extractAudioLevelFromStats(stats)).toBe(1);
  });

  it("returns undefined when no numeric audioLevel exists", () => {
    expect(extractAudioLevelFromStats({ first: { bytesSent: 120 } })).toBeUndefined();
  });
});
