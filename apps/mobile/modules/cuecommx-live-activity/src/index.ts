import { Platform } from "react-native";
import { type EventSubscription, requireOptionalNativeModule } from "expo-modules-core";

export interface LiveActivityState {
  isTalking: boolean;
  isArmed: boolean;
  talkChannelNames: string[];
  listenChannelNames: string[];
  activeTalkers: string[];
  connectedUserCount: number;
}

const NativeModule =
  Platform.OS === "ios" ? requireOptionalNativeModule("CueCommXLiveActivity") : null;

/** Start (or restart) the Live Activity. Call once when audio becomes ready. */
export function startLiveActivity(userName: string, serverName: string): void {
  if (!NativeModule) return;
  NativeModule.startActivity(userName, serverName);
}

/** Update the Live Activity with current talk/channel/user state. */
export function updateLiveActivity(state: LiveActivityState): void {
  if (!NativeModule) return;
  NativeModule.updateActivity(
    state.isTalking,
    state.isArmed,
    state.talkChannelNames,
    state.listenChannelNames,
    state.activeTalkers,
    state.connectedUserCount
  );
}

/** End and dismiss the Live Activity. Call when audio is disarmed or user signs out. */
export function endLiveActivity(): void {
  NativeModule?.endActivity();
}

/** Listen for the toggle-talk event fired when the user taps the Live Activity button. */
export function addToggleTalkListener(
  listener: () => void
): EventSubscription | undefined {
  if (!NativeModule) return undefined;
  return NativeModule.addListener("onToggleTalk", listener) as EventSubscription;
}
