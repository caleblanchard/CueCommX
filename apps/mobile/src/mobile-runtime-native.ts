import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import * as Haptics from "expo-haptics";
import * as IntentLauncher from "expo-intent-launcher";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { createAndroidLiveAudioNotificationContent } from "./mobile-runtime";

export const ANDROID_LIVE_AUDIO_NOTIFICATION_CHANNEL_ID = "cuecommx-live-audio";

let notificationHandlerRegistered = false;

export function ensureMobileNotificationHandlerRegistered(): void {
  if (notificationHandlerRegistered) {
    return;
  }

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: false,
      shouldShowList: true,
    }),
  });
  notificationHandlerRegistered = true;
}

export async function configureMobileAudioSession(): Promise<void> {
  const existingPermissions = await getRecordingPermissionsAsync();
  const microphonePermissions = existingPermissions.granted
    ? existingPermissions
    : await requestRecordingPermissionsAsync();

  if (!microphonePermissions.granted) {
    throw new Error("CueCommX needs microphone permission before mobile audio can start.");
  }

  // On Android, configure the audio mode explicitly since react-native-webrtc
  // doesn't fully manage the audio session on that platform.
  if (Platform.OS === "android") {
    await setAudioModeAsync({
      allowsRecording: true,
      interruptionMode: "doNotMix",
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      shouldRouteThroughEarpiece: false,
    });
  }

  // On iOS, react-native-webrtc manages the AVAudioSession automatically
  // when getUserMedia is called. Do NOT call setAudioModeAsync or
  // RTCAudioSession.audioSessionDidActivate here — doing so conflicts with
  // WebRTC's internal session management and results in a silent mic track.
}

export async function resetMobileAudioSession(): Promise<void> {
  // On Android, reset the audio mode since we configured it manually.
  if (Platform.OS === "android") {
    await setAudioModeAsync({
      allowsRecording: false,
      interruptionMode: "mixWithOthers",
      playsInSilentMode: false,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    });
  }

  // On iOS, react-native-webrtc cleans up the AVAudioSession when
  // transports and tracks are closed. No manual intervention needed.
}

export async function ensureAndroidRuntimeSupport(): Promise<boolean> {
  if (Platform.OS !== "android") {
    return true;
  }

  await Notifications.setNotificationChannelAsync(ANDROID_LIVE_AUDIO_NOTIFICATION_CHANNEL_ID, {
    name: "CueCommX live audio",
    description: "Shows when CueCommX is holding an active intercom audio session in the background.",
    importance: Notifications.AndroidImportance.LOW,
    enableVibrate: false,
    showBadge: false,
    sound: null,
  });

  const existingPermissions = await Notifications.getPermissionsAsync();

  if (existingPermissions.granted) {
    return true;
  }

  const requestedPermissions = await Notifications.requestPermissionsAsync();
  return requestedPermissions.granted;
}

export async function showAndroidLiveAudioNotification(input: {
  serverName?: string;
  username: string;
  activeChannelNames?: string[];
  listenChannelNames?: string[];
}): Promise<string | undefined> {
  if (Platform.OS !== "android") {
    return undefined;
  }

  const content = createAndroidLiveAudioNotificationContent(input);

  return await Notifications.scheduleNotificationAsync({
    content: {
      ...content,
      autoDismiss: false,
      priority: Notifications.AndroidNotificationPriority.DEFAULT,
      sound: false,
      sticky: true,
    },
    trigger: {
      channelId: ANDROID_LIVE_AUDIO_NOTIFICATION_CHANNEL_ID,
    },
  });
}

export async function hideAndroidLiveAudioNotification(
  notificationId: string | undefined,
): Promise<void> {
  if (Platform.OS !== "android" || !notificationId) {
    return;
  }

  await Notifications.dismissNotificationAsync(notificationId);
}

export async function openAndroidBatteryOptimizationSettings(): Promise<void> {
  if (Platform.OS !== "android") {
    return;
  }

  await IntentLauncher.startActivityAsync(
    IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS,
  );
}

export async function triggerListenToggleHaptic(): Promise<void> {
  await Haptics.selectionAsync();
}

export async function triggerTalkHaptic(action: "mode" | "start" | "stop"): Promise<void> {
  if (action === "mode") {
    await Haptics.selectionAsync();
    return;
  }

  await Haptics.impactAsync(
    action === "start"
      ? Haptics.ImpactFeedbackStyle.Heavy
      : Haptics.ImpactFeedbackStyle.Light,
  );
}

export async function triggerCallSignalHaptic(): Promise<void> {
  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
}

export async function triggerAllPageHaptic(): Promise<void> {
  // Double impact for all-page — heavy + slight delay + heavy
  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  await new Promise((r) => setTimeout(r, 100));
  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
}

export async function triggerDirectCallHaptic(): Promise<void> {
  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

export async function triggerConnectionLostHaptic(): Promise<void> {
  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
}

export async function triggerMessageHaptic(): Promise<void> {
  await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}
