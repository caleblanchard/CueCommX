import { describe, expect, it, vi } from "vitest";

import { PROTOCOL_VERSION } from "@cuecommx/protocol";

import { CueCommXMdnsAdvertiser } from "../src/discovery/mdns.js";

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
};

describe("CueCommXMdnsAdvertiser", () => {
  it("publishes a _cuecommx._tcp bonjour service with server metadata", async () => {
    const start = vi.fn();
    const stop = vi.fn();
    const publish = vi.fn(() => ({
      start,
      stop,
    }));
    const destroy = vi.fn((callback?: CallableFunction) => callback?.());
    const advertiser = new CueCommXMdnsAdvertiser({
      bonjourFactory: () => ({
        destroy,
        publish,
      }),
      config: baseConfig,
    });

    advertiser.start();

    expect(publish).toHaveBeenCalledWith({
      name: "Main Church",
      type: "cuecommx",
      protocol: "tcp",
      port: 3000,
      txt: {
        path: "/",
        protocolVersion: PROTOCOL_VERSION,
        serverName: "Main Church",
      },
    });
    expect(start).toHaveBeenCalled();
    expect(advertiser.getStatus()).toEqual({
      enabled: true,
      name: "Main Church",
      port: 3000,
      protocol: "tcp",
      serviceType: "_cuecommx._tcp",
    });

    await advertiser.stop();

    expect(stop).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
    expect(advertiser.getStatus().enabled).toBe(false);
  });

  it("captures bonjour startup errors in the advertised status", () => {
    const advertiser = new CueCommXMdnsAdvertiser({
      bonjourFactory: () => {
        throw new Error("multicast unavailable");
      },
      config: baseConfig,
    });

    advertiser.start();

    expect(advertiser.getStatus()).toEqual({
      enabled: false,
      error: "multicast unavailable",
      name: "Main Church",
      port: 3000,
      protocol: "tcp",
      serviceType: "_cuecommx._tcp",
    });
  });
});
