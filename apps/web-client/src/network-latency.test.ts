import { describe, expect, it } from "vitest";

import { formatLatencyIndicator, readNetworkRtt } from "./network-latency.js";

describe("readNetworkRtt", () => {
  it("returns a rounded RTT when the browser exposes one", () => {
    expect(readNetworkRtt({ connection: { rtt: 12.7 } })).toBe(13);
  });

  it("ignores missing or invalid RTT values", () => {
    expect(readNetworkRtt(undefined)).toBeUndefined();
    expect(readNetworkRtt({ connection: { rtt: 0 } })).toBeUndefined();
    expect(readNetworkRtt({ connection: { rtt: "fast" } })).toBeUndefined();
  });
});

describe("formatLatencyIndicator", () => {
  it("formats a friendly operator-facing label", () => {
    expect(formatLatencyIndicator(undefined)).toBe("LAN-local");
    expect(formatLatencyIndicator(18)).toBe("~18 ms");
  });
});
