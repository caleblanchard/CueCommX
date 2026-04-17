import { describe, expect, it, vi } from "vitest";

import {
  loadMobileServerShell,
  loginMobileOperator,
  normalizeMobileServerUrl,
  resolveMobileServerBaseUrls,
} from "./mobile-session.js";

describe("normalizeMobileServerUrl", () => {
  it("adds http and strips extra path segments for manual LAN targets", () => {
    expect(normalizeMobileServerUrl("10.0.0.25:3000/admin?x=1")).toBe("http://10.0.0.25:3000/");
  });

  it("preserves explicit https server URLs", () => {
    expect(normalizeMobileServerUrl("https://cuecommx.local:3443/admin?x=1")).toBe(
      "https://cuecommx.local:3443/",
    );
  });

  it("rejects unsupported protocols", () => {
    expect(() => normalizeMobileServerUrl("ftp://10.0.0.25:3000")).toThrow(
      "CueCommX mobile requires an http:// or https:// server URL.",
    );
  });
});

describe("resolveMobileServerBaseUrls", () => {
  it("tries https before http when the manual target omits a scheme", () => {
    expect(resolveMobileServerBaseUrls("10.0.0.25:3000/admin")).toEqual([
      "https://10.0.0.25:3000/",
      "http://10.0.0.25:3000/",
    ]);
  });

  it("keeps an explicit scheme as the only candidate", () => {
    expect(resolveMobileServerBaseUrls("https://cuecommx.local:3443/admin")).toEqual([
      "https://cuecommx.local:3443/",
    ]);
  });
});

describe("loadMobileServerShell", () => {
  it("prefers https for manual targets that omit a scheme", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = input instanceof URL ? input.toString() : input.toString();

      if (url.endsWith("/api/status")) {
        return new Response(
          JSON.stringify({
            name: "CueCommX Local Server",
            version: "0.1.0",
            uptime: 12,
            connectedUsers: 3,
            maxUsers: 30,
            channels: 5,
            needsAdminSetup: false,
            protocolVersion: 1,
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          announcedHost: "10.0.0.25",
          detectedInterfaces: [
            {
              name: "en0",
              address: "10.0.0.25",
              url: "https://10.0.0.25:3000",
            },
          ],
          primaryUrl: "https://10.0.0.25:3000",
          primaryTargetId: "primary",
          connectTargets: [
            {
              id: "primary",
              label: "Primary",
              url: "https://10.0.0.25:3000",
              kind: "announced",
            },
          ],
          mdns: {
            enabled: true,
            name: "CueCommX Local Server",
            port: 3000,
            protocol: "tcp",
            serviceType: "_cuecommx._tcp",
          },
        }),
        { status: 200 },
      );
    });

    const shell = await loadMobileServerShell(fetchImpl, "10.0.0.25:3000/admin");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(shell.baseUrl).toBe("https://10.0.0.25:3000/");
    expect(shell.status.connectedUsers).toBe(3);
    expect(shell.discovery.primaryTargetId).toBe("primary");
  });

  it("falls back to http when https is unavailable for a manual target", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = input instanceof URL ? input.toString() : input.toString();

      if (url.startsWith("https://")) {
        throw new TypeError("fetch failed");
      }

      if (url.endsWith("/api/status")) {
        return new Response(
          JSON.stringify({
            name: "CueCommX Local Server",
            version: "0.1.0",
            uptime: 12,
            connectedUsers: 3,
            maxUsers: 30,
            channels: 5,
            needsAdminSetup: false,
            protocolVersion: 1,
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          announcedHost: "10.0.0.25",
          detectedInterfaces: [
            {
              name: "en0",
              address: "10.0.0.25",
              url: "http://10.0.0.25:3000",
            },
          ],
          primaryUrl: "http://10.0.0.25:3000",
          primaryTargetId: "primary",
          connectTargets: [
            {
              id: "primary",
              label: "Primary",
              url: "http://10.0.0.25:3000",
              kind: "announced",
            },
          ],
          mdns: {
            enabled: true,
            name: "CueCommX Local Server",
            port: 3000,
            protocol: "tcp",
            serviceType: "_cuecommx._tcp",
          },
        }),
        { status: 200 },
      );
    });

    const shell = await loadMobileServerShell(fetchImpl, "10.0.0.25:3000/admin");

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(shell.baseUrl).toBe("http://10.0.0.25:3000/");
  });
});

describe("loginMobileOperator", () => {
  it("posts operator credentials and returns the parsed auth payload", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify({ username: "audio1", pin: "1234" }));

      return new Response(
        JSON.stringify({
          success: true,
          protocolVersion: 1,
          sessionToken: "session-123",
          user: {
            id: "user-audio1",
            username: "audio1",
            role: "operator",
            channelPermissions: [],
          },
          channels: [],
        }),
        { status: 200 },
      );
    });

    const result = await loginMobileOperator(fetchImpl, {
      serverUrl: "http://10.0.0.25:3000/",
      username: "audio1",
      pin: "1234",
    });

    expect(result.sessionToken).toBe("session-123");
    expect(result.user.username).toBe("audio1");
  });
});
