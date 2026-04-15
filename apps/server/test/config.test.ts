import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loads the documented defaults", () => {
    const config = loadConfig({}, { cwd: "/tmp/cuecommx" });

    expect(config.serverName).toBe("CueCommX");
    expect(config.port).toBe(3000);
    expect(config.rtcMinPort).toBe(40000);
    expect(config.rtcMaxPort).toBe(41000);
    expect(config.dbPath).toBe("/tmp/cuecommx/data/cuecommx.db");
    expect(config.tls).toBeUndefined();
  });

  it("loads optional TLS file paths relative to the current working directory", () => {
    const config = loadConfig(
      {
        CUECOMMX_TLS_CERT_FILE: "./certs/cuecommx.pem",
        CUECOMMX_TLS_KEY_FILE: "./certs/cuecommx-key.pem",
      },
      { cwd: "/tmp/cuecommx" },
    );

    expect(config.tls).toEqual({
      certPath: "/tmp/cuecommx/certs/cuecommx.pem",
      keyPath: "/tmp/cuecommx/certs/cuecommx-key.pem",
    });
  });

  it("rejects an invalid RTP port range", () => {
    expect(() =>
      loadConfig(
        {
          CUECOMMX_RTC_MIN_PORT: "41000",
          CUECOMMX_RTC_MAX_PORT: "40000",
        },
        { cwd: "/tmp/cuecommx" },
      ),
    ).toThrowError();
  });

  it("rejects partial TLS configuration", () => {
    expect(() =>
      loadConfig(
        {
          CUECOMMX_TLS_CERT_FILE: "./certs/cuecommx.pem",
        },
        { cwd: "/tmp/cuecommx" },
      ),
    ).toThrowError(/must both be set/);
  });
});
