import { describe, expect, it } from "vitest";

import { getReconnectDelay, setChannelVolume, toggleChannelId } from "../src/index.js";

describe("getReconnectDelay", () => {
  it("grows exponentially with jitter until it reaches the cap", () => {
    expect(getReconnectDelay(1, { baseDelayMs: 100, maxDelayMs: 1_000, jitterMs: 50 }, () => 0))
      .toBe(100);
    expect(getReconnectDelay(3, { baseDelayMs: 100, maxDelayMs: 1_000, jitterMs: 50 }, () => 0))
      .toBe(400);
    expect(getReconnectDelay(8, { baseDelayMs: 100, maxDelayMs: 1_000, jitterMs: 50 }, () => 0))
      .toBe(1_000);
  });

  it("rejects invalid attempts", () => {
    expect(() => getReconnectDelay(0)).toThrowError();
  });
});

describe("channel state helpers", () => {
  it("adds and removes talk channels without duplicates", () => {
    const added = toggleChannelId(["ch-production"], "ch-audio", true);
    const duplicated = toggleChannelId(added, "ch-audio", true);
    const removed = toggleChannelId(duplicated, "ch-production", false);

    expect(duplicated).toEqual(["ch-audio", "ch-production"]);
    expect(removed).toEqual(["ch-audio"]);
  });

  it("updates per-channel volume immutably", () => {
    const next = setChannelVolume(
      {
        talkChannelIds: [],
        listenChannelIds: [],
        volumes: {},
        masterVolume: 1,
      },
      "ch-production",
      0.7,
    );

    expect(next.volumes["ch-production"]).toBe(0.7);
  });
});
