import type { RealtimeConnectionState } from "@cuecommx/core";
import type { AppStateStatus } from "react-native";

export function canArmMobileAudio(input: {
  hasSession: boolean;
  realtimeState: RealtimeConnectionState;
}): boolean {
  return input.hasSession && input.realtimeState === "connected";
}

export function getAudioStatusLabel(input: {
  audioArmed: boolean;
  audioBusy: boolean;
  audioReady: boolean;
}): string {
  if (input.audioReady) {
    return "Live";
  }

  if (input.audioBusy) {
    return "Arming";
  }

  if (input.audioArmed) {
    return "Waiting on media";
  }

  return "Standby";
}

export function describeMobileAudioError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : "CueCommX could not start mobile audio.";

  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("permission")) {
    return "CueCommX needs microphone permission before mobile audio can start.";
  }

  if (
    normalizedMessage.includes("did not receive an audio track") ||
    normalizedMessage.includes("local audio track is not available")
  ) {
    return `${message} This commonly happens on iOS Simulator, which does not reliably expose a live microphone to CueCommX. If this keeps happening, test on a physical iPhone or iPad.`;
  }

  return message;
}

export function shouldKeepScreenAwake(input: {
  audioArmed: boolean;
  hasSession: boolean;
}): boolean {
  return input.hasSession && input.audioArmed;
}

export function shouldKeepAndroidSessionNotification(input: {
  appLifecycleState: AppStateStatus;
  audioArmed: boolean;
  hasSession: boolean;
  platformOs: string;
}): boolean {
  return (
    input.platformOs === "android" &&
    input.hasSession &&
    input.audioArmed &&
    input.appLifecycleState !== "active"
  );
}

export function shouldShowAndroidRuntimeTools(input: {
  hasSession: boolean;
  platformOs: string;
}): boolean {
  return input.platformOs === "android" && input.hasSession;
}

export function createAndroidLiveAudioNotificationContent(input: {
  serverName?: string;
  username: string;
}): {
  body: string;
  title: string;
} {
  const destination = input.serverName ?? "the CueCommX server";

  return {
    title: "CueCommX live audio ready",
    body: `${input.username} is keeping comms armed on ${destination}.`,
  };
}
