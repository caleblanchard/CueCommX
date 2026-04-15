import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";
import * as Haptics from "expo-haptics";
import * as IntentLauncher from "expo-intent-launcher";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { RTCAudioSession } from "react-native-webrtc";

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
  const existingPermissions = await Audio.getPermissionsAsync();
  const microphonePermissions = existingPermissions.granted
    ? existingPermissions
    : await Audio.requestPermissionsAsync();

  if (!microphonePermissions.granted) {
    throw new Error("CueCommX needs microphone permission before mobile audio can start.");
  }

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
    interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
  });

  if (Platform.OS === "ios") {
    RTCAudioSession.audioSessionDidActivate();
  }
}

export async function resetMobileAudioSession(): Promise<void> {
  if (Platform.OS === "ios") {
    RTCAudioSession.audioSessionDidDeactivate();
  }

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
    playsInSilentModeIOS: false,
    staysActiveInBackground: false,
    interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: false,
  });
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
