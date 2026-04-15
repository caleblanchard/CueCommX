import { describe, expect, it } from "vitest";

import { resolveTalkGesture } from "./mobile-controls.js";

describe("resolveTalkGesture", () => {
  it("uses press in/out for momentary talk mode", () => {
    expect(
      resolveTalkGesture({
        isTalking: false,
        mode: "momentary",
        phase: "press-in",
      }),
    ).toBe("start");
    expect(
      resolveTalkGesture({
        isTalking: true,
        mode: "momentary",
        phase: "press-out",
      }),
    ).toBe("stop");
  });

  it("toggles talk state on tap in latched mode", () => {
    expect(
      resolveTalkGesture({
        isTalking: false,
        mode: "latched",
        phase: "tap",
      }),
    ).toBe("start");
    expect(
      resolveTalkGesture({
        isTalking: true,
        mode: "latched",
        phase: "tap",
      }),
    ).toBe("stop");
  });

  it("ignores incompatible gesture phases", () => {
    expect(
      resolveTalkGesture({
        isTalking: false,
        mode: "latched",
        phase: "press-in",
      }),
    ).toBeUndefined();
    expect(
      resolveTalkGesture({
        isTalking: false,
        mode: "momentary",
        phase: "tap",
      }),
    ).toBeUndefined();
  });
});
