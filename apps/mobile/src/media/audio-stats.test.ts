import { describe, expect, it } from "vitest";

import {
  computeRmsLevel,
  extractAudioLevelFromStats,
  extractEnergySnapshot,
} from "./audio-stats.js";

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

describe("extractEnergySnapshot", () => {
  it("extracts energy and duration from a Map-based stats report", () => {
    const stats = new Map<string, Record<string, unknown>>([
      ["s1", { type: "media-source", totalAudioEnergy: 0.05, totalSamplesDuration: 2.0 }],
    ]);

    expect(extractEnergySnapshot(stats)).toEqual({
      totalAudioEnergy: 0.05,
      totalSamplesDuration: 2.0,
    });
  });

  it("accepts string values for energy fields", () => {
    const stats = {
      src: { totalAudioEnergy: "0.1", totalSamplesDuration: "3.5" },
    };

    expect(extractEnergySnapshot(stats)).toEqual({
      totalAudioEnergy: 0.1,
      totalSamplesDuration: 3.5,
    });
  });

  it("returns undefined when energy fields are missing", () => {
    const stats = new Map([["s1", { type: "outbound-rtp", bytesSent: 1200 }]]);

    expect(extractEnergySnapshot(stats)).toBeUndefined();
  });

  it("returns undefined when duration is zero", () => {
    const stats = { src: { totalAudioEnergy: 0.0, totalSamplesDuration: 0 } };

    expect(extractEnergySnapshot(stats)).toBeUndefined();
  });
});

describe("computeRmsLevel", () => {
  it("computes RMS audio level from energy deltas", () => {
    const prev = { totalAudioEnergy: 0.0, totalSamplesDuration: 1.0 };
    const curr = { totalAudioEnergy: 0.25, totalSamplesDuration: 2.0 };

    // RMS = sqrt(0.25 / 1.0) = 0.5
    expect(computeRmsLevel(prev, curr)).toBe(0.5);
  });

  it("returns undefined when duration has not advanced", () => {
    const snap = { totalAudioEnergy: 0.1, totalSamplesDuration: 1.0 };

    expect(computeRmsLevel(snap, snap)).toBeUndefined();
  });

  it("clamps the result to [0, 1]", () => {
    const prev = { totalAudioEnergy: 0.0, totalSamplesDuration: 1.0 };
    const curr = { totalAudioEnergy: 2.0, totalSamplesDuration: 2.0 };

    // RMS = sqrt(2.0 / 1.0) = ~1.414, clamped to 1
    expect(computeRmsLevel(prev, curr)).toBe(1);
  });
});
