import { describe, expect, it } from "vitest";

import config from "../app.config";

describe("app.config", () => {
  it("allows both cleartext and TLS server connections on mobile", () => {
    expect(config.android?.usesCleartextTraffic).toBe(true);
    expect(config.ios?.infoPlist?.NSAppTransportSecurity).toEqual({
      NSAllowsArbitraryLoads: true,
      NSAllowsLocalNetworking: true,
    });
  });
});
