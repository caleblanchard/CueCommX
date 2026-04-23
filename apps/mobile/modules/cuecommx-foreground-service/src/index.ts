import { Platform } from "react-native";
import { type EventSubscription, requireOptionalNativeModule } from "expo-modules-core";

export interface ForegroundServiceState {
  isTalking: boolean;
  isArmed: boolean;
  talkChannelNames: string[];
  listenChannelNames: string[];
  activeTalkers: string[];
  connectedUserCount: number;
}

const NativeModule =
  Platform.OS === "android"
    ? requireOptionalNativeModule("CueCommXForegroundService")
    : null;

/** Start the foreground service and show the persistent notification. */
export function startForegroundService(userName: string, serverName: string): void {
  NativeModule?.startService(userName, serverName);
}

/** Update the notification with current talk/channel/user state. */
export function updateForegroundService(state: ForegroundServiceState): void {
  NativeModule?.updateService(
    state.isTalking,
    state.isArmed,
    state.talkChannelNames,
    state.listenChannelNames,
    state.activeTalkers,
    state.connectedUserCount
  );
}

/** Stop the foreground service and dismiss the notification. */
export function stopForegroundService(): void {
  NativeModule?.stopService();
}

/** Listen for the toggle-talk event fired when the user taps the notification action. */
export function addForegroundServiceToggleTalkListener(
  listener: () => void
): EventSubscription | undefined {
  if (!NativeModule) return undefined;
  return NativeModule.addListener("onToggleTalk", listener) as EventSubscription;
}
