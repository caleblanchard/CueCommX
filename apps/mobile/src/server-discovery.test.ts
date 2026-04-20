import { describe, expect, it } from "vitest";

import {
  buildDiscoveredServerUrl,
  makeDiscoveredServerId,
} from "./server-discovery";

describe("buildDiscoveredServerUrl", () => {
  it("constructs http URL from host and port", () => {
    expect(buildDiscoveredServerUrl("192.168.1.100", 3000)).toBe("http://192.168.1.100:3000");
  });

  it("strips trailing dot from mDNS host", () => {
    expect(buildDiscoveredServerUrl("cuecommx.local.", 3000)).toBe("http://cuecommx.local:3000");
  });

  it("handles numeric IP hosts without modification", () => {
    expect(buildDiscoveredServerUrl("10.0.0.5", 4000)).toBe("http://10.0.0.5:4000");
  });

  it("does not double-strip when host has no trailing dot", () => {
    expect(buildDiscoveredServerUrl("cuecommx.local", 3000)).toBe("http://cuecommx.local:3000");
  });
});

describe("makeDiscoveredServerId", () => {
  it("lowercases and replaces non-alphanumeric with hyphens", () => {
    expect(makeDiscoveredServerId("Production Room")).toBe("production-room");
  });

  it("collapses multiple non-alphanumeric chars into one hyphen", () => {
    expect(makeDiscoveredServerId("CueCommX -- Stage")).toBe("cuecommx-stage");
  });

  it("handles simple alphanumeric names unchanged except lowercasing", () => {
    expect(makeDiscoveredServerId("Stage1")).toBe("stage1");
  });

  it("handles names with dots (from mDNS service names)", () => {
    expect(makeDiscoveredServerId("cuecommx.local")).toBe("cuecommx-local");
  });
});

