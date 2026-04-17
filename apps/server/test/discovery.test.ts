import type { NetworkInterfaceInfo } from "node:os";

import { describe, expect, it } from "vitest";

import { buildDiscoveryResponse, resolveMediaAnnouncedHost } from "../src/discovery/targets.js";

const baseConfig = {
  serverName: "Main Church",
  host: "0.0.0.0",
  port: 3000,
  rtcMinPort: 40000,
  rtcMaxPort: 41000,
  announcedIp: undefined,
  dataDir: "/tmp/cuecommx",
  dbFile: "cuecommx.db",
  dbPath: "/tmp/cuecommx/cuecommx.db",
  maxUsers: 30,
  maxChannels: 16,
  logLevel: "info" as const,
  httpsPort: 3443,
};

function createIPv4(address: string, internal: boolean): NetworkInterfaceInfo {
  return {
    address,
    cidr: `${address}/24`,
    family: "IPv4",
    internal,
    mac: "00:00:00:00:00:00",
    netmask: "255.255.255.0",
  };
}

describe("buildDiscoveryResponse", () => {
  it("prefers the announced IP for the primary QR/manual connect target", () => {
    const response = buildDiscoveryResponse(
      {
        ...baseConfig,
        announcedIp: "10.0.0.25",
      },
      {
        headersHost: "localhost:3000",
        networkInterfacesMap: {
          en0: [createIPv4("10.0.0.30", false)],
          lo0: [createIPv4("127.0.0.1", true)],
        },
      },
    );

    expect(response.primaryUrl).toBe("http://10.0.0.25:3000/");
    expect(response.primaryTargetId).toBe("announced-10-0-0-25");
    expect(response.announcedHost).toBe("10.0.0.25");
    expect(response.detectedInterfaces).toEqual([
      {
        address: "10.0.0.30",
        name: "en0",
        url: "http://10.0.0.30:3000/",
      },
    ]);
    expect(response.connectTargets.map((target) => target.url)).toEqual([
      "http://10.0.0.25:3000/",
      "http://10.0.0.30:3000/",
      "http://localhost:3000/",
    ]);
  });

  it("uses the current browser origin when it is already a LAN-friendly host", () => {
    const response = buildDiscoveryResponse(baseConfig, {
      headersHost: "cuecommx.local:3000",
      networkInterfacesMap: {
        en0: [createIPv4("10.0.0.25", false)],
      },
    });

    expect(response.primaryUrl).toBe("http://cuecommx.local:3000/");
    expect(response.primaryTargetId).toBe("browser-cuecommx-local");
    expect(response.detectedInterfaces).toEqual([
      {
        address: "10.0.0.25",
        name: "en0",
        url: "http://10.0.0.25:3000/",
      },
    ]);
    expect(response.connectTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "browser",
          label: "Current browser origin",
          url: "http://cuecommx.local:3000/",
        }),
        expect.objectContaining({
          kind: "lan",
          label: "LAN URL (en0)",
          url: "http://10.0.0.25:3000/",
        }),
      ]),
    );
  });

  it("falls back to localhost when no LAN address is available", () => {
    const response = buildDiscoveryResponse(baseConfig, {
      networkInterfacesMap: {
        lo0: [createIPv4("127.0.0.1", true)],
      },
    });

    expect(response).toEqual({
      announcedHost: undefined,
      detectedInterfaces: [],
      primaryUrl: "http://localhost:3000/",
      primaryTargetId: "loopback-localhost",
      connectTargets: [
        {
          id: "loopback-localhost",
          kind: "loopback",
          label: "This machine only",
          url: "http://localhost:3000/",
        },
      ],
    });
  });

  it("emits HTTPS discovery URLs when the server is running on HTTPS", () => {
    const response = buildDiscoveryResponse(baseConfig, {
      headersHost: "cuecommx.local:3000",
      networkInterfacesMap: {
        en0: [createIPv4("10.0.0.25", false)],
      },
      protocol: "https",
    });

    expect(response.primaryUrl).toBe("https://cuecommx.local:3000/");
    expect(response.detectedInterfaces).toEqual([
      {
        address: "10.0.0.25",
        name: "en0",
        url: "https://10.0.0.25:3000/",
      },
    ]);
    expect(response.connectTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "browser",
          url: "https://cuecommx.local:3000/",
        }),
        expect.objectContaining({
          kind: "lan",
          url: "https://10.0.0.25:3000/",
        }),
      ]),
    );
  });
});

describe("resolveMediaAnnouncedHost", () => {
  it("prefers the explicit announced IP when configured", () => {
    expect(
      resolveMediaAnnouncedHost(
        {
          ...baseConfig,
          announcedIp: "10.0.0.25",
        },
        {
          en0: [createIPv4("10.0.0.30", false)],
        },
      ),
    ).toBe("10.0.0.25");
  });

  it("uses a specific configured host when it is already LAN reachable", () => {
    expect(
      resolveMediaAnnouncedHost(
        {
          ...baseConfig,
          host: "10.0.0.44",
        },
        {
          en0: [createIPv4("10.0.0.30", false)],
        },
      ),
    ).toBe("10.0.0.44");
  });

  it("auto-detects the first LAN host when running on a wildcard bind", () => {
    expect(
      resolveMediaAnnouncedHost(baseConfig, {
        en0: [createIPv4("10.0.0.30", false)],
        lo0: [createIPv4("127.0.0.1", true)],
      }),
    ).toBe("10.0.0.30");
  });

  it("returns undefined when only loopback addresses are available", () => {
    expect(
      resolveMediaAnnouncedHost(baseConfig, {
        lo0: [createIPv4("127.0.0.1", true)],
      }),
    ).toBeUndefined();
  });
});
