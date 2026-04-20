import { describe, expect, it } from "vitest";

import { buildOscConfig, OscService } from "./service.js";

describe("OscService", () => {
  describe("buildOscConfig", () => {
    it("returns default config when env vars absent", () => {
      const config = buildOscConfig({});
      expect(config.enabled).toBe(false);
      expect(config.listenPort).toBe(8765);
      expect(config.sendHost).toBe("127.0.0.1");
      expect(config.sendPort).toBe(9000);
    });

    it("parses env vars correctly", () => {
      const config = buildOscConfig({
        CUECOMMX_OSC_ENABLED: "true",
        CUECOMMX_OSC_LISTEN_PORT: "7000",
        CUECOMMX_OSC_SEND_HOST: "192.168.1.50",
        CUECOMMX_OSC_SEND_PORT: "9999",
      });
      expect(config.enabled).toBe(true);
      expect(config.listenPort).toBe(7000);
      expect(config.sendHost).toBe("192.168.1.50");
      expect(config.sendPort).toBe(9999);
    });

    it("treats 'false' as disabled", () => {
      const config = buildOscConfig({ CUECOMMX_OSC_ENABLED: "false" });
      expect(config.enabled).toBe(false);
    });
  });

  describe("OscService (disabled)", () => {
    it("does not start when disabled", () => {
      const service = new OscService({
        enabled: false,
        listenPort: 8765,
        sendHost: "127.0.0.1",
        sendPort: 9000,
      });
      service.start();
      expect(service.isRunning).toBe(false);
    });

    it("getConfig returns a copy of the config", () => {
      const service = new OscService({
        enabled: false,
        listenPort: 8765,
        sendHost: "127.0.0.1",
        sendPort: 9000,
      });
      const config = service.getConfig();
      expect(config.enabled).toBe(false);
      expect(config.listenPort).toBe(8765);
    });

    it("notifyUserOnline is a no-op when not running", () => {
      const service = new OscService({
        enabled: false,
        listenPort: 8765,
        sendHost: "127.0.0.1",
        sendPort: 9000,
      });
      expect(() => service.notifyUserOnline("user-1", "Alice")).not.toThrow();
    });

    it("notifyUserOffline is a no-op when not running", () => {
      const service = new OscService({
        enabled: false,
        listenPort: 8765,
        sendHost: "127.0.0.1",
        sendPort: 9000,
      });
      expect(() => service.notifyUserOffline("user-1", "Alice")).not.toThrow();
    });

    it("notifyAllPageStart is a no-op when not running", () => {
      const service = new OscService({
        enabled: false,
        listenPort: 8765,
        sendHost: "127.0.0.1",
        sendPort: 9000,
      });
      expect(() => service.notifyAllPageStart("Alice")).not.toThrow();
    });

    it("notifyAllPageStop is a no-op when not running", () => {
      const service = new OscService({
        enabled: false,
        listenPort: 8765,
        sendHost: "127.0.0.1",
        sendPort: 9000,
      });
      expect(() => service.notifyAllPageStop()).not.toThrow();
    });

    it("notifyUserTalking is a no-op when not running", () => {
      const service = new OscService({
        enabled: false,
        listenPort: 8765,
        sendHost: "127.0.0.1",
        sendPort: 9000,
      });
      expect(() => service.notifyUserTalking("user-1", "ch-1")).not.toThrow();
    });

    it("notifyUserStopped is a no-op when not running", () => {
      const service = new OscService({
        enabled: false,
        listenPort: 8765,
        sendHost: "127.0.0.1",
        sendPort: 9000,
      });
      expect(() => service.notifyUserStopped("user-1", ["ch-1"])).not.toThrow();
    });
  });

  describe("incoming OSC callback routing", () => {
    it("invokes onMuteUser callback for mute:1", () => {
      const service = new OscService({
        enabled: false,
        listenPort: 8765,
        sendHost: "127.0.0.1",
        sendPort: 9000,
      });

      let capturedUserId: string | undefined;
      let capturedMuted: boolean | undefined;
      service.setCallbacks({
        onMuteUser: (userId, muted) => {
          capturedUserId = userId;
          capturedMuted = muted;
        },
      });

      // Simulate incoming message by calling the private handler via a trick:
      // expose as a public helper for testing
      (service as unknown as { handleIncoming: (a: string, b: unknown[]) => void }).handleIncoming(
        "/cuecommx/user/user-123/mute",
        [1],
      );

      expect(capturedUserId).toBe("user-123");
      expect(capturedMuted).toBe(true);
    });

    it("invokes onMuteUser with muted=false for value 0", () => {
      const service = new OscService({
        enabled: false,
        listenPort: 8765,
        sendHost: "127.0.0.1",
        sendPort: 9000,
      });

      let capturedMuted: boolean | undefined;
      service.setCallbacks({
        onMuteUser: (_, muted) => {
          capturedMuted = muted;
        },
      });

      (service as unknown as { handleIncoming: (a: string, b: unknown[]) => void }).handleIncoming(
        "/cuecommx/user/user-abc/mute",
        [0],
      );

      expect(capturedMuted).toBe(false);
    });

    it("invokes onAllPageStart callback", () => {
      const service = new OscService({
        enabled: false,
        listenPort: 8765,
        sendHost: "127.0.0.1",
        sendPort: 9000,
      });

      let called = false;
      service.setCallbacks({ onAllPageStart: () => { called = true; } });

      (service as unknown as { handleIncoming: (a: string, b: unknown[]) => void }).handleIncoming(
        "/cuecommx/allpage/start",
        [],
      );

      expect(called).toBe(true);
    });

    it("invokes onAllPageStop callback", () => {
      const service = new OscService({
        enabled: false,
        listenPort: 8765,
        sendHost: "127.0.0.1",
        sendPort: 9000,
      });

      let called = false;
      service.setCallbacks({ onAllPageStop: () => { called = true; } });

      (service as unknown as { handleIncoming: (a: string, b: unknown[]) => void }).handleIncoming(
        "/cuecommx/allpage/stop",
        [],
      );

      expect(called).toBe(true);
    });

    it("does not throw for unknown addresses", () => {
      const service = new OscService({
        enabled: false,
        listenPort: 8765,
        sendHost: "127.0.0.1",
        sendPort: 9000,
      });
      expect(() =>
        (service as unknown as { handleIncoming: (a: string, b: unknown[]) => void }).handleIncoming(
          "/unknown/address",
          [],
        ),
      ).not.toThrow();
    });
  });
});
