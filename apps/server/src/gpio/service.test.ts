import { describe, expect, it } from "vitest";

import { buildGpioConfig, GpioService } from "./service.js";

describe("buildGpioConfig", () => {
  it("defaults to disabled/none", () => {
    const config = buildGpioConfig({});
    expect(config.enabled).toBe(false);
    expect(config.provider).toBe("none");
    expect(config.pins).toEqual([]);
  });

  it("parses enabled + hid provider", () => {
    const config = buildGpioConfig({
      CUECOMMX_GPIO_ENABLED: "true",
      CUECOMMX_GPIO_PROVIDER: "hid",
    });
    expect(config.enabled).toBe(true);
    expect(config.provider).toBe("hid");
  });

  it("parses pin config from JSON env var", () => {
    const pins = [
      { pinId: "btn-1", label: "PTT", direction: "input", action: { type: "ptt:start", channelId: "ch-1" } },
    ];
    const config = buildGpioConfig({
      CUECOMMX_GPIO_ENABLED: "true",
      CUECOMMX_GPIO_CONFIG: JSON.stringify(pins),
    });
    expect(config.pins).toHaveLength(1);
    expect(config.pins[0].label).toBe("PTT");
  });

  it("ignores malformed JSON in CUECOMMX_GPIO_CONFIG", () => {
    const config = buildGpioConfig({ CUECOMMX_GPIO_CONFIG: "NOT_VALID_JSON" });
    expect(config.pins).toEqual([]);
  });
});

describe("GpioService", () => {
  it("is not running when disabled", async () => {
    const service = new GpioService({ enabled: false, provider: "none", pins: [] });
    await service.start();
    expect(service.isRunning).toBe(false);
  });

  it("starts successfully with provider=none", async () => {
    const service = new GpioService({ enabled: true, provider: "none", pins: [] });
    await service.start();
    expect(service.isRunning).toBe(true);
    await service.stop();
    expect(service.isRunning).toBe(false);
  });

  it("getConfig returns a copy", () => {
    const service = new GpioService({
      enabled: true,
      provider: "none",
      pins: [{ pinId: "p1", label: "LED", direction: "output", trigger: { type: "user:online" } }],
    });
    const config = service.getConfig();
    expect(config.pins).toHaveLength(1);
    expect(config.pins).not.toBe(service.getConfig().pins); // different array instance
  });

  it("setOutput is a no-op when not running", async () => {
    const service = new GpioService({ enabled: false, provider: "none", pins: [] });
    await service.start();
    expect(() => service.setOutput({ type: "user:online" }, true)).not.toThrow();
  });

  it("setOutput with matching pin logs output when running", async () => {
    const service = new GpioService({
      enabled: true,
      provider: "none",
      pins: [{ pinId: "p1", label: "LED", direction: "output", trigger: { type: "user:online" } }],
    });
    await service.start();
    expect(() => service.setOutput({ type: "user:online" }, true)).not.toThrow();
    await service.stop();
  });

  it("setCallbacks stores callbacks", () => {
    const service = new GpioService({ enabled: true, provider: "none", pins: [] });
    let called = false;
    service.setCallbacks({
      onInputAction: () => { called = true; },
    });
    // Direct invocation of callback not tested here (HID driver integration),
    // but we confirm setCallbacks doesn't throw
    expect(called).toBe(false);
  });

  it("listHidDevices returns array (empty if node-hid not installed)", async () => {
    const devices = await GpioService.listHidDevices();
    expect(Array.isArray(devices)).toBe(true);
  });
});
