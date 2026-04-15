import { describe, expect, it } from "vitest";

import {
  buildMobileFoundationState,
  previewChannels,
  previewStatus,
} from "./mobile-foundation.js";

describe("buildMobileFoundationState", () => {
  it("uses the shared default channels and reconnect policy", () => {
    const state = buildMobileFoundationState(previewStatus, previewChannels);

    expect(state.channels).toHaveLength(5);
    expect(state.channels[0]?.name).toBe("Production");
    expect(state.firstReconnectDelayMs).toBe(250);
  });

  it("keeps the primary talk target at or above the 60pt UX minimum", () => {
    const state = buildMobileFoundationState(previewStatus, previewChannels);

    expect(state.talkTargetHeight).toBeGreaterThanOrEqual(60);
  });
});
