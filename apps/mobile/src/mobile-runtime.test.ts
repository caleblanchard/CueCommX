import { describe, expect, it } from "vitest";

import {
  canArmMobileAudio,
  createAndroidLiveAudioNotificationContent,
  describeMobileAudioError,
  getAudioStatusLabel,
  shouldKeepAndroidSessionNotification,
  shouldKeepScreenAwake,
  shouldShowAndroidRuntimeTools,
} from "./mobile-runtime.js";

describe("getAudioStatusLabel", () => {
  it("prioritizes live and arming states over standby", () => {
    expect(getAudioStatusLabel({ audioArmed: true, audioBusy: false, audioReady: true })).toBe(
      "Live",
    );
    expect(getAudioStatusLabel({ audioArmed: true, audioBusy: true, audioReady: false })).toBe(
      "Arming",
    );
    expect(getAudioStatusLabel({ audioArmed: true, audioBusy: false, audioReady: false })).toBe(
      "Waiting on media",
    );
    expect(getAudioStatusLabel({ audioArmed: false, audioBusy: false, audioReady: false })).toBe(
      "Standby",
    );
  });
});

describe("canArmMobileAudio", () => {
  it("requires a signed-in connected realtime session", () => {
    expect(canArmMobileAudio({ hasSession: true, realtimeState: "connected" })).toBe(true);
    expect(canArmMobileAudio({ hasSession: false, realtimeState: "connected" })).toBe(false);
    expect(canArmMobileAudio({ hasSession: true, realtimeState: "reconnecting" })).toBe(false);
  });
});

describe("describeMobileAudioError", () => {
  it("promotes microphone permission failures into a clear operator-facing message", () => {
    expect(describeMobileAudioError(new Error("Permission denied"))).toBe(
      "CueCommX needs microphone permission before mobile audio can start.",
    );
  });

  it("adds simulator guidance when no local audio track is available", () => {
    expect(
      describeMobileAudioError(new Error("CueCommX did not receive an audio track from this device.")),
    ).toContain("iOS Simulator");
  });
});

describe("shouldKeepScreenAwake", () => {
  it("stays awake only while a signed-in operator has armed audio", () => {
    expect(shouldKeepScreenAwake({ audioArmed: true, hasSession: true })).toBe(true);
    expect(shouldKeepScreenAwake({ audioArmed: false, hasSession: true })).toBe(false);
    expect(shouldKeepScreenAwake({ audioArmed: true, hasSession: false })).toBe(false);
  });
});

describe("shouldKeepAndroidSessionNotification", () => {
  it("keeps the Android live-audio alert only while the app is backgrounded with armed audio", () => {
    expect(
      shouldKeepAndroidSessionNotification({
        appLifecycleState: "background",
        audioArmed: true,
        hasSession: true,
        platformOs: "android",
      }),
    ).toBe(true);
    expect(
      shouldKeepAndroidSessionNotification({
        appLifecycleState: "active",
        audioArmed: true,
        hasSession: true,
        platformOs: "android",
      }),
    ).toBe(false);
    expect(
      shouldKeepAndroidSessionNotification({
        appLifecycleState: "background",
        audioArmed: true,
        hasSession: true,
        platformOs: "ios",
      }),
    ).toBe(false);
  });
});

describe("shouldShowAndroidRuntimeTools", () => {
  it("shows Android battery/runtime actions only for signed-in Android operators", () => {
    expect(shouldShowAndroidRuntimeTools({ hasSession: true, platformOs: "android" })).toBe(true);
    expect(shouldShowAndroidRuntimeTools({ hasSession: false, platformOs: "android" })).toBe(false);
    expect(shouldShowAndroidRuntimeTools({ hasSession: true, platformOs: "ios" })).toBe(false);
  });
});

describe("createAndroidLiveAudioNotificationContent", () => {
  it("builds an operator-facing live audio notification", () => {
    expect(
      createAndroidLiveAudioNotificationContent({
        serverName: "Main Church",
        username: "A2",
      }),
    ).toEqual({
      title: "CueCommX live audio ready",
      body: "A2 is keeping comms armed on Main Church.",
    });
  });
});
