import { StatusBar } from "expo-status-bar";
import { CameraView, useCameraPermissions } from "expo-camera";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Slider from "@react-native-community/slider";
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  FlatList,
  InteractionManager,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  Vibration,
  View,
  useWindowDimensions,
} from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { CueCommXRealtimeClient, type RealtimeConnectionState } from "@cuecommx/core";
import type {
  AuthSuccessResponse,
  CallSignalType,
  ChannelInfo,
  ChannelPermission,
  ChatMessagePayload,
  ConnectionQuality,
  DiscoveryResponse,
  GroupInfo,
  OperatorState,
  ServerSignalingMessage,
  StatusResponse,
  TallySourceState,
} from "@cuecommx/protocol";

import { resolveTalkGesture, type MobileTalkMode } from "./src/mobile-controls";
import { deferMobileOperation } from "./src/mobile-feedback";
import {
  createMobileMediaController,
  type MobileRemoteTalkerSnapshot,
} from "./src/media/mobile-media-controller";
import {
  loadMobileServerShell,
  loginMobileOperator,
} from "./src/mobile-session";
import { loadPersistedServerUrl, persistServerUrl } from "./src/server-url-storage";
import { useServerDiscovery } from "./src/server-discovery";
import {
  canArmMobileAudio,
  describeMobileAudioError,
  shouldKeepAndroidSessionNotification,
  getAudioStatusLabel,
  shouldKeepScreenAwake,
  shouldShowAndroidRuntimeTools,
} from "./src/mobile-runtime";
import {
  configureMobileAudioSession,
  ensureAndroidRuntimeSupport,
  ensureMobileNotificationHandlerRegistered,
  hideAndroidLiveAudioNotification,
  openAndroidBatteryOptimizationSettings,
  resetMobileAudioSession,
  showAndroidLiveAudioNotification,
  triggerListenToggleHaptic,
  triggerTalkHaptic,
  triggerCallSignalHaptic,
  triggerAllPageHaptic,
  triggerDirectCallHaptic,
  triggerConnectionLostHaptic,
  triggerMessageHaptic,
} from "./src/mobile-runtime-native";

interface ViewState {
  discovery?: DiscoveryResponse;
  loginError?: string;
  loginPending: boolean;
  operatorState?: OperatorState;
  realtimeError?: string;
  realtimeState: RealtimeConnectionState;
  serverBaseUrl?: string;
  serverError?: string;
  serverLoading: boolean;
  session?: AuthSuccessResponse;
  status?: StatusResponse;
}

const initialState: ViewState = {
  loginPending: false,
  realtimeState: "idle",
  serverLoading: false,
};

const inputClassName =
  "min-h-12 rounded-xl border border-border bg-background/70 px-4 py-3 text-base text-foreground";
const ANDROID_NOTIFICATION_GUIDANCE =
  "Enable Android notifications so CueCommX can keep a visible live-audio alert while the app is backgrounded.";

function getConnectionBadge(
  realtimeState: RealtimeConnectionState,
): { label: string; toneClassName: string } {
  switch (realtimeState) {
    case "connected":
      return {
        label: "Live linked",
        toneClassName: "border-success/30 bg-success/10 text-success",
      };
    case "reconnecting":
      return {
        label: "Reconnecting",
        toneClassName: "border-warning/30 bg-warning/10 text-warning",
      };
    case "connecting":
      return {
        label: "Linking session",
        toneClassName: "border-primary/30 bg-primary/10 text-primary",
      };
    case "closed":
      return {
        label: "Disconnected",
        toneClassName: "border-warning/30 bg-warning/10 text-warning",
      };
    default:
      return {
        label: "Waiting",
        toneClassName: "border-border bg-secondary/70 text-muted-foreground",
      };
  }
}

function countPermissions(
  permissions: ChannelPermission[],
  mode: "listen" | "talk",
): number {
  return permissions.filter((permission) => (mode === "listen" ? permission.canListen : permission.canTalk))
    .length;
}

function findPermission(
  permissions: ChannelPermission[],
  channelId: string,
): ChannelPermission | undefined {
  return permissions.find((entry) => entry.channelId === channelId);
}

function toFraction(percent: number): number {
  return Math.max(0, Math.min(100, percent)) / 100;
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View className="flex-row items-start justify-between gap-4">
      <Text className="flex-1 text-xs font-semibold uppercase tracking-control text-muted-foreground">
        {label}
      </Text>
      <Text className="max-w-[65%] text-right text-sm font-medium text-foreground">{value}</Text>
    </View>
  );
}

function SectionCard({
  children,
}: {
  children: ReactNode;
}) {
  return <View className="gap-4 rounded-2xl border border-border bg-card/90 p-5 shadow-panel">{children}</View>;
}

function ActionButton({
  disabled,
  label,
  onPress,
  tone = "primary",
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
  tone?: "primary" | "secondary";
}) {
  const className =
    tone === "primary"
      ? "min-h-touch items-center justify-center rounded-xl bg-primary px-4 py-3 shadow-command"
      : "min-h-touch items-center justify-center rounded-xl border border-border bg-secondary px-4 py-3";
  const textClassName =
    tone === "primary"
      ? "text-sm font-semibold uppercase tracking-control text-primary-foreground"
      : "text-sm font-semibold uppercase tracking-control text-foreground";

  return (
    <Pressable
      accessibilityRole="button"
      className={`${className} ${disabled ? "opacity-50" : ""}`}
      disabled={disabled}
      onPress={onPress}
    >
      <Text className={textClassName}>{label}</Text>
    </Pressable>
  );
}

function ChannelPermissionCard({
  channelType,
  connected,
  canListen,
  canTalk,
  color,
  isAllPageBlocked,
  isGlobal,
  isListening,
  isRecording,
  isSource,
  isTalking,
  isVoxMode,
  name,
  onChat,
  onSignal,
  onToggleListen,
  onTalkPress,
  onVolumeChange,
  role,
  talkReady,
  talkMode,
  unreadCount,
  volumePercent,
}: {
  channelType?: "intercom" | "program" | "confidence";
  connected: boolean;
  canListen: boolean;
  canTalk: boolean;
  color: string;
  isAllPageBlocked: boolean;
  isGlobal: boolean;
  isListening: boolean;
  isRecording: boolean;
  isSource: boolean;
  isTalking: boolean;
  isVoxMode: boolean;
  name: string;
  onChat: () => void;
  onSignal?: (signalType: CallSignalType) => void;
  onToggleListen: () => void;
  onTalkPress: (phase: "press-in" | "press-out" | "tap") => void;
  onVolumeChange: (value: number) => void;
  role?: string;
  talkReady: boolean;
  talkMode: MobileTalkMode;
  unreadCount: number;
  volumePercent: number;
}) {
  const [signalMenuOpen, setSignalMenuOpen] = useState(false);
  const isProgram = channelType === "program";
  const hideTalk = isProgram && !isSource;
  const talkBlocked = isAllPageBlocked;
  const listenEnabled = connected && canListen;
  const talkEnabled = connected && canTalk && talkReady && !hideTalk && !talkBlocked;
  const canSignal = (role === "admin" || role === "operator") && onSignal;

  const talkLabel = talkBlocked
    ? "All-Page active"
    : isVoxMode
      ? "VOX auto"
      : isTalking
        ? "Talking"
        : !talkReady && canTalk
          ? "Arm audio"
          : talkMode === "momentary"
            ? "Hold to talk"
            : "Toggle talk";

  return (
    <View className="overflow-hidden rounded-xl border border-border bg-background/60">
      <View className="h-1.5 w-full" style={{ backgroundColor: color }} />
      <View className="gap-3 p-4">
        <View className="flex-row items-center gap-2">
          <Text className="text-base font-semibold text-foreground">{name}</Text>
          {isGlobal ? (
            <Text className="text-sm" accessibilityLabel="Global channel">
              {String.fromCodePoint(0x1f310)}
            </Text>
          ) : null}
          {isProgram ? (
            <View className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5">
              <Text className="text-[10px] font-semibold uppercase tracking-control text-amber-400">
                {String.fromCodePoint(0x1f4e1)} Program
              </Text>
            </View>
          ) : null}
          {isVoxMode && canTalk ? (
            <View className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5">
              <Text className="text-[10px] font-semibold uppercase tracking-control text-primary">VOX</Text>
            </View>
          ) : null}
          {isRecording ? (
            <View className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5">
              <Text className="text-[10px] font-semibold uppercase tracking-control text-destructive">● REC</Text>
            </View>
          ) : null}
        </View>
        <View className="flex-row flex-wrap gap-2">
          <View
            className={`rounded-full px-3 py-1 ${
              canListen ? "border border-success/30 bg-success/10" : "border border-border bg-secondary/70"
            }`}
          >
            <Text
              className={`text-[11px] font-semibold uppercase tracking-control ${
                canListen ? "text-success" : "text-muted-foreground"
              }`}
            >
              {canListen ? (isListening ? "Listening live" : "Listen armed") : "No listen"}
            </Text>
          </View>
          {!hideTalk ? (
            <View
              className={`rounded-full px-3 py-1 ${
                canTalk
                  ? isTalking
                    ? "border border-primary bg-primary/20"
                    : "border border-primary/30 bg-primary/10"
                  : "border border-border bg-secondary/70"
              }`}
            >
              <Text
                className={`text-[11px] font-semibold uppercase tracking-control ${
                  canTalk ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {canTalk ? (isTalking ? "Talking live" : "Talk assigned") : "No talk"}
              </Text>
            </View>
          ) : null}
          {!hideTalk ? (
            <View className="rounded-full border border-border bg-secondary/70 px-3 py-1">
              <Text className="text-[11px] font-semibold uppercase tracking-control text-muted-foreground">
                {talkMode === "momentary" ? "Momentary PTT" : "Latched Talk"}
              </Text>
            </View>
          ) : null}
        </View>

        <View className="flex-row gap-3">
          <Pressable
            accessibilityRole="button"
            className={`min-h-touch flex-1 items-center justify-center rounded-xl border px-4 py-3 ${
              isListening
                ? "border-success/40 bg-success/15"
                : "border-border bg-secondary"
            } ${listenEnabled ? "" : "opacity-50"}`}
            disabled={!listenEnabled}
            onPress={onToggleListen}
          >
            <Text
              className={`text-sm font-semibold uppercase tracking-control ${
                isListening ? "text-success" : "text-foreground"
              }`}
            >
              {isListening ? "Stop listen" : "Listen"}
            </Text>
          </Pressable>
          {!hideTalk ? (
            <Pressable
              accessibilityRole="button"
              className={`min-h-touch flex-1 items-center justify-center rounded-xl px-4 py-3 shadow-command ${
                isTalking ? "bg-primary/80" : "bg-primary"
              } ${talkEnabled ? "" : "opacity-50"}`}
              disabled={!talkEnabled}
              onPress={talkMode === "latched" ? () => onTalkPress("tap") : undefined}
              onPressIn={talkMode === "momentary" ? () => onTalkPress("press-in") : undefined}
              onPressOut={talkMode === "momentary" ? () => onTalkPress("press-out") : undefined}
            >
              <Text className="text-sm font-semibold uppercase tracking-control text-primary-foreground">
                {talkLabel}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {canSignal ? (
          <View>
            <Pressable
              accessibilityRole="button"
              className="items-center rounded-xl border border-border bg-secondary px-4 py-2"
              onPress={() => setSignalMenuOpen(!signalMenuOpen)}
            >
              <Text className="text-xs font-semibold uppercase tracking-control text-foreground">Signal</Text>
            </Pressable>
            {signalMenuOpen ? (
              <View className="mt-2 gap-1 rounded-xl border border-border bg-card p-2">
                <Pressable
                  className="rounded-lg px-3 py-2"
                  onPress={() => { onSignal("call"); setSignalMenuOpen(false); }}
                >
                  <Text className="text-sm font-medium text-red-400">{String.fromCodePoint(0x1f4de)} Call</Text>
                </Pressable>
                <Pressable
                  className="rounded-lg px-3 py-2"
                  onPress={() => { onSignal("standby"); setSignalMenuOpen(false); }}
                >
                  <Text className="text-sm font-medium text-amber-400">{String.fromCodePoint(0x23f3)} Standby</Text>
                </Pressable>
                <Pressable
                  className="rounded-lg px-3 py-2"
                  onPress={() => { onSignal("go"); setSignalMenuOpen(false); }}
                >
                  <Text className="text-sm font-medium text-green-400">{String.fromCodePoint(0x1f7e2)} Go</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          className="flex-row items-center justify-center gap-2 rounded-xl border border-border bg-secondary px-4 py-2"
          onPress={onChat}
        >
          <Text className="text-xs font-semibold uppercase tracking-control text-foreground">
            {String.fromCodePoint(0x1f4ac)} Chat
          </Text>
          {unreadCount > 0 ? (
            <View className="h-5 min-w-[20px] items-center justify-center rounded-full bg-destructive px-1">
              <Text className="text-[10px] font-bold text-white">{unreadCount}</Text>
            </View>
          ) : null}
        </Pressable>

        <View className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
              Monitor level
            </Text>
            <Text className="text-xs font-semibold text-foreground">{volumePercent}%</Text>
          </View>
          <Slider
            disabled={!canListen}
            maximumTrackTintColor="#334155"
            maximumValue={100}
            minimumTrackTintColor={color}
            minimumValue={0}
            onValueChange={onVolumeChange}
            step={5}
            thumbTintColor={color}
            value={volumePercent}
          />
        </View>
      </View>
    </View>
  );
}

export default function App() {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;
  const isTablet = Math.min(windowWidth, windowHeight) >= 600;
  const [state, setState] = useState<ViewState>(initialState);
  const [serverUrlInput, setServerUrlInput] = useState("");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [appLifecycleState, setAppLifecycleState] = useState<AppStateStatus>(AppState.currentState);
  const [androidBackgroundAlertActive, setAndroidBackgroundAlertActive] = useState(false);
  const [audioArmed, setAudioArmed] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioError, setAudioError] = useState<string>();
  const [audioReady, setAudioReady] = useState(false);
  const [channelVolumes, setChannelVolumes] = useState<Record<string, number>>({});
  const [hapticsAvailable, setHapticsAvailable] = useState(true);
  const [inputLevel, setInputLevel] = useState(0);
  const [masterVolume, setMasterVolume] = useState(100);
  const [remoteTalkers, setRemoteTalkers] = useState<MobileRemoteTalkerSnapshot[]>([]);
  const [runtimeNotice, setRuntimeNotice] = useState<string>();
  const [talkMode, setTalkMode] = useState<MobileTalkMode>("momentary");
  const [audioProcessing, setAudioProcessing] = useState({
    noiseSuppression: true,
    autoGainControl: true,
    echoCancellation: true,
  });
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileNotice, setProfileNotice] = useState<string>();
  const [allPageActive, setAllPageActive] = useState<{ userId: string; username: string } | undefined>();
  const [recordingActiveIds, setRecordingActiveIds] = useState<string[]>([]);
  const [tallySources, setTallySources] = useState<TallySourceState[]>([]);
  const [incomingSignals, setIncomingSignals] = useState<Array<{ signalId: string; signalType: CallSignalType; fromUsername: string; targetChannelId?: string }>>([]);
  const [onlineUsers, setOnlineUsers] = useState<Array<{ id: string; username: string }>>([]);
  const [directCall, setDirectCall] = useState<{
    callId: string;
    peerUserId: string;
    peerUsername: string;
    state: "requesting" | "ringing" | "active";
  } | null>(null);
  const [incomingCall, setIncomingCall] = useState<{
    callId: string;
    fromUserId: string;
    fromUsername: string;
  } | null>(null);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | undefined>();
  const [ifbState, setIFBState] = useState<{
    fromUserId: string;
    fromUsername: string;
    duckLevel: number;
  } | null>(null);
  const [duckingEnabled, setDuckingEnabled] = useState(true);
  const [voxEnabled, setVoxEnabled] = useState(false);
  const [voxThreshold, setVoxThreshold] = useState(15);
  const [preflightStep, setPreflightStep] = useState<"idle" | "recording" | "done">("idle");
  const [preflightPassed, setPreflightPassed] = useState<boolean | undefined>();
  const [chatMessages, setChatMessages] = useState<Record<string, ChatMessagePayload[]>>({});
  const [chatOpen, setChatOpen] = useState<string | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [chatInput, setChatInput] = useState("");
  const chatListRef = useRef<FlatList<ChatMessagePayload>>(null);
  const androidNotificationIdRef = useRef<string | undefined>(undefined);
  const mediaControllerRef = useRef<ReturnType<typeof createMobileMediaController> | null>(null);
  const realtimeClientRef = useRef<CueCommXRealtimeClient | null>(null);
  const qrScannedRef = useRef(false);

  const [qrScanOpen, setQrScanOpen] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const { servers: discoveredServers, scanning: discoveryScanning } = useServerDiscovery();

  const connectionBadge = getConnectionBadge(state.realtimeState);
  const assignedPermissions = state.session?.user.channelPermissions ?? [];
  const activeChannels = state.session?.channels ?? [];
  const showAndroidRuntimeSupport = shouldShowAndroidRuntimeTools({
    hasSession: !!state.session,
    platformOs: Platform.OS,
  });
  const audioStatusLabel = getAudioStatusLabel({
    audioArmed,
    audioBusy,
    audioReady,
  });
  const mixChannelVolumes = useMemo(
    () =>
      Object.fromEntries(
        activeChannels.map((channel) => {
          const baseVolume = toFraction(channelVolumes[channel.id] ?? 100);
          const duckedVolume = ifbState && (channel as ChannelInfo).channelType === "program"
            ? baseVolume * ifbState.duckLevel
            : baseVolume;
          return [channel.id, duckedVolume];
        }),
      ),
    [activeChannels, channelVolumes, ifbState],
  );
  const visibleChannels: ChannelInfo[] = useMemo(() => {
    const allChannels = (state.session?.channels ?? []) as ChannelInfo[];
    const nonConfidence = allChannels.filter((ch) => ch.channelType !== "confidence");

    if (groups.length === 0 || !activeGroupId) {
      return nonConfidence;
    }

    const activeGroup = groups.find((g) => g.id === activeGroupId);

    if (!activeGroup) {
      return nonConfidence;
    }

    const groupChannelSet = new Set(activeGroup.channelIds);
    const globals = nonConfidence.filter((ch) => ch.isGlobal);
    const groupChannels = nonConfidence.filter(
      (ch) => !ch.isGlobal && groupChannelSet.has(ch.id),
    );

    return [...globals, ...groupChannels];
  }, [state.session?.channels, groups, activeGroupId]);

  const confidenceChannels: ChannelInfo[] = useMemo(() =>
    ((state.session?.channels ?? []) as ChannelInfo[]).filter((ch) => ch.channelType === "confidence"),
    [state.session?.channels],
  );

  const listenChannelIds = state.operatorState?.listenChannelIds ?? [];

  function getRuntimeMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
  }

  function updateServerUrlInput(value: string): void {
    setServerUrlInput(value);
    void persistServerUrl(value).catch((error: unknown) => {
      setRuntimeNotice(getRuntimeMessage(error, "CueCommX could not save the last server URL."));
    });
  }

  function queueHapticFeedback(operation: () => Promise<void>): void {
    if (!hapticsAvailable) {
      return;
    }

    deferMobileOperation(
      operation,
      (error: unknown) => {
        setHapticsAvailable(false);
        setRuntimeNotice(
          `${getRuntimeMessage(error, "CueCommX haptics are unavailable in this build.")} Haptics will stay off for this session.`,
        );
      },
      (task) => {
        InteractionManager.runAfterInteractions(task);
      },
    );
  }

  useEffect(() => {
    const subscription = AppState.addEventListener("change", setAppLifecycleState);

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    ensureMobileNotificationHandlerRegistered();
  }, []);

  useEffect(() => {
    let active = true;

    void loadPersistedServerUrl()
      .then((persistedServerUrl) => {
        if (!active || !persistedServerUrl) {
          return;
        }

        setServerUrlInput((current) => current || persistedServerUrl);
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        setRuntimeNotice(getRuntimeMessage(error, "CueCommX could not restore the last server URL."));
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      !shouldKeepScreenAwake({
        audioArmed,
        hasSession: !!state.session,
      })
    ) {
      return;
    }

    void activateKeepAwakeAsync();

    return () => {
      deactivateKeepAwake();
    };
  }, [audioArmed, state.session?.sessionToken]);

  useEffect(() => {
    const session = state.session;
    const shouldShowBackgroundAlert = shouldKeepAndroidSessionNotification({
      appLifecycleState,
      audioArmed,
      hasSession: !!session,
      platformOs: Platform.OS,
    });
    const currentNotificationId = androidNotificationIdRef.current;

    if (!shouldShowBackgroundAlert || !session) {
      androidNotificationIdRef.current = undefined;
      setAndroidBackgroundAlertActive(false);

      if (currentNotificationId) {
        void hideAndroidLiveAudioNotification(currentNotificationId).catch((error: unknown) => {
          setRuntimeNotice(
            getRuntimeMessage(error, "CueCommX could not clear the Android live-audio alert."),
          );
        });
      }

      return;
    }

    let cancelled = false;

    void ensureAndroidRuntimeSupport()
      .then(async (notificationsEnabled) => {
        if (cancelled) {
          return;
        }

        if (!notificationsEnabled) {
          setAndroidBackgroundAlertActive(false);
          setRuntimeNotice(ANDROID_NOTIFICATION_GUIDANCE);
          return;
        }

        setRuntimeNotice((current) =>
          current === ANDROID_NOTIFICATION_GUIDANCE ? undefined : current,
        );

        if (androidNotificationIdRef.current) {
          setAndroidBackgroundAlertActive(true);
          return;
        }

        const notificationId = await showAndroidLiveAudioNotification({
          serverName: state.status?.name,
          username: session.user.username,
          activeChannelNames: activeChannels
            .filter((ch) => state.operatorState?.talkChannelIds.includes(ch.id))
            .map((ch) => ch.name),
          listenChannelNames: activeChannels
            .filter((ch) => state.operatorState?.listenChannelIds.includes(ch.id))
            .map((ch) => ch.name),
        });

        if (cancelled) {
          await hideAndroidLiveAudioNotification(notificationId);
          return;
        }

        androidNotificationIdRef.current = notificationId;
        setAndroidBackgroundAlertActive(Boolean(notificationId));
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setRuntimeNotice(
            getRuntimeMessage(
              error,
              "CueCommX could not prepare the Android live-audio background alert.",
            ),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [appLifecycleState, audioArmed, state.session, state.status?.name]);

  useEffect(() => {
    if (!state.session || !state.serverBaseUrl) {
      return;
    }

    let active = true;
    const realtimeClient = new CueCommXRealtimeClient({
      baseUrl: state.serverBaseUrl,
      onConnectionStateChange: (realtimeState) => {
        if (!active) {
          return;
        }

        setState((current) => {
          if (current.realtimeState === "connected" && realtimeState !== "connected") {
            queueHapticFeedback(() => triggerConnectionLostHaptic());
          }
          return { ...current, realtimeState };
        });
      },
      onError: (error) => {
        if (!active) {
          return;
        }

        setState((current) => ({
          ...current,
          realtimeError: error.message,
        }));
      },
      onMessage: (message: ServerSignalingMessage) => {
        if (!active) {
          return;
        }

        void mediaControllerRef.current?.handleServerMessage(message);

        setState((current) => {
          if (message.type === "session:ready") {
            if (message.payload.groups) {
              setGroups(message.payload.groups);
            }

            return {
              ...current,
              operatorState: message.payload.operatorState,
              realtimeError: undefined,
              session: current.session
                ? {
                    ...current.session,
                    channels: message.payload.channels,
                    user: message.payload.user,
                  }
                : current.session,
              status: current.status
                ? {
                    ...current.status,
                    connectedUsers: message.payload.connectedUsers,
                  }
                : current.status,
            };
          }

          if (message.type === "presence:update") {
            return {
              ...current,
              status: current.status
                ? {
                    ...current.status,
                    connectedUsers: message.payload.connectedUsers,
                  }
                : current.status,
            };
          }

          if (message.type === "operator-state") {
            return {
              ...current,
              operatorState: message.payload,
              realtimeError: undefined,
            };
          }

          if (message.type === "signal:error") {
            return {
              ...current,
              realtimeError: message.payload.message,
            };
          }

          if (message.type === "force-muted") {
            const notice =
              message.payload.reason === "user"
                ? "An admin has force-muted your microphone"
                : "An admin unlatched channel audio";
            setRuntimeNotice(notice);
          }

          return current;
        });

        if (message.type === "allpage:active") {
          setAllPageActive(message.payload);
          queueHapticFeedback(() => triggerAllPageHaptic());
        }

        if (message.type === "allpage:inactive") {
          setAllPageActive(undefined);
        }

        if (message.type === "signal:incoming") {
          setIncomingSignals((prev) => [
            ...prev,
            {
              signalId: message.payload.signalId,
              signalType: message.payload.signalType,
              fromUsername: message.payload.fromUsername,
              targetChannelId: message.payload.targetChannelId,
            },
          ]);
          queueHapticFeedback(() => triggerCallSignalHaptic());
        }

        if (message.type === "signal:cleared") {
          setIncomingSignals((prev) => prev.filter((s) => s.signalId !== message.payload.signalId));
        }

        if (message.type === "online:users") {
          setOnlineUsers(message.payload.users);
        }

        if (message.type === "direct:incoming") {
          setIncomingCall({
            callId: message.payload.callId,
            fromUserId: message.payload.fromUserId,
            fromUsername: message.payload.fromUsername,
          });
          queueHapticFeedback(() => triggerDirectCallHaptic());
        }

        if (message.type === "direct:active") {
          setIncomingCall(null);
          setDirectCall({
            callId: message.payload.callId,
            peerUserId: message.payload.peerUserId,
            peerUsername: message.payload.peerUsername,
            state: "active",
          });
        }

        if (message.type === "direct:ended") {
          setDirectCall(null);
          setIncomingCall(null);
        }

        if (message.type === "ifb:active") {
          setIFBState({
            fromUserId: message.payload.fromUserId,
            fromUsername: message.payload.fromUsername,
            duckLevel: message.payload.duckLevel,
          });
        }

        if (message.type === "ifb:inactive") {
          setIFBState(null);
        }

        if (message.type === "chat:message") {
          const msg = message.payload;
          setChatMessages((prev) => {
            const channelMsgs = prev[msg.channelId] ?? [];
            return { ...prev, [msg.channelId]: [...channelMsgs, msg] };
          });
          setChatOpen((openChannel) => {
            if (openChannel !== msg.channelId) {
              setUnreadCounts((prev) => ({
                ...prev,
                [msg.channelId]: (prev[msg.channelId] ?? 0) + 1,
              }));
              Vibration.vibrate(50);
            }
            return openChannel;
          });
        }

        if (message.type === "chat:history") {
          setChatMessages((prev) => ({
            ...prev,
            [message.payload.channelId]: message.payload.messages,
          }));
        }

        if (message.type === "recording:state") {
          setRecordingActiveIds(message.payload.activeChannelIds);
        }

        if (message.type === "tally:update") {
          setTallySources(message.payload.sources);
        }
      },
      sessionToken: state.session.sessionToken,
    });
    const mediaController = createMobileMediaController({
      audioConstraints: audioProcessing,
      onConnectionQualityChange: (quality) => {
        if (!active) {
          return;
        }

        setConnectionQuality(quality ?? null);
      },
      onError: (error) => {
        if (!active) {
          return;
        }

        setAudioError(describeMobileAudioError(error));
      },
      onLocalLevelChange: (level) => {
        if (!active) {
          return;
        }

        setInputLevel(level);
      },
      onRemoteTalkersChange: (talkers) => {
        if (!active) {
          return;
        }

        setRemoteTalkers(talkers);
      },
      realtimeClient,
    });

    mediaControllerRef.current = mediaController;
    realtimeClientRef.current = realtimeClient;
    realtimeClient.connect();

    return () => {
      active = false;
      const notificationId = androidNotificationIdRef.current;

      androidNotificationIdRef.current = undefined;
      mediaControllerRef.current = null;
      realtimeClientRef.current = null;
      realtimeClient.disconnect();
      void mediaController.close();
      void resetMobileAudioSession().catch((error: unknown) => {
        setRuntimeNotice(
          getRuntimeMessage(error, "CueCommX could not reset the mobile audio session."),
        );
      });
      if (notificationId) {
        void hideAndroidLiveAudioNotification(notificationId).catch((error: unknown) => {
          setRuntimeNotice(
            getRuntimeMessage(error, "CueCommX could not clear the Android live-audio alert."),
          );
        });
      }
      setAndroidBackgroundAlertActive(false);
      setAudioArmed(false);
      setAudioBusy(false);
      setAudioError(undefined);
      setAudioReady(false);
      setChannelVolumes({});
      setConnectionQuality(null);
      setHapticsAvailable(true);
      setInputLevel(0);
      setMasterVolume(100);
      setRemoteTalkers([]);
      setRuntimeNotice(undefined);
      setAllPageActive(undefined);
      setIncomingSignals([]);
      setOnlineUsers([]);
      setDirectCall(null);
      setIncomingCall(null);
      setGroups([]);
      setActiveGroupId(undefined);
      setIFBState(null);
      setVoxEnabled(false);
      setPreflightStep("idle");
      setPreflightPassed(undefined);
    };
  }, [state.serverBaseUrl, state.session?.sessionToken]);

  useEffect(() => {
    if (!activeChannels.length) {
      return;
    }

    setChannelVolumes((current) => {
      let changed = false;
      const next = { ...current };
      const activeChannelIds = new Set(activeChannels.map((channel) => channel.id));

      for (const channel of activeChannels) {
        if (next[channel.id] === undefined) {
          next[channel.id] = 100;
          changed = true;
        }
      }

      for (const channelId of Object.keys(next)) {
        if (!activeChannelIds.has(channelId)) {
          delete next[channelId];
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [activeChannels]);

  useEffect(() => {
    mediaControllerRef.current?.updateMix({
      activeListenChannelIds: listenChannelIds,
      activeTalkerChannelIds: remoteTalkers.flatMap((t) => t.activeChannelIds),
      channelPriorities: Object.fromEntries(
        activeChannels.map((ch) => [ch.id, (ch as ChannelInfo).priority ?? 5]),
      ),
      channelVolumes: mixChannelVolumes,
      duckingEnabled,
      duckLevel: 0.3,
      masterVolume: toFraction(masterVolume),
    });
  }, [activeChannels, duckingEnabled, listenChannelIds, masterVolume, mixChannelVolumes, remoteTalkers]);

  // Auto-listen on confidence channels
  useEffect(() => {
    if (!state.session || !state.operatorState || state.realtimeState !== "connected") {
      return;
    }
    const currentListenIds = new Set(state.operatorState.listenChannelIds);
    for (const ch of confidenceChannels) {
      const perm = assignedPermissions.find((p) => p.channelId === ch.id);
      if (perm?.canListen && !currentListenIds.has(ch.id)) {
        realtimeClientRef.current?.toggleListen(ch.id, true);
      }
    }
  }, [assignedPermissions, confidenceChannels, state.operatorState, state.realtimeState, state.session]);

  const mediaStartingRef = useRef(false);

  useEffect(() => {
    if (!audioArmed || !mediaControllerRef.current) {
      return;
    }

    if (state.realtimeState !== "connected") {
      mediaControllerRef.current.resetConnection();
      setAudioReady(false);
      setRemoteTalkers([]);
      return;
    }

    if (audioReady || mediaStartingRef.current) {
      return;
    }

    mediaStartingRef.current = true;
    setAudioBusy(true);

    const controller = mediaControllerRef.current;

    void controller
      .start()
      .then(() => {
        setAudioError(undefined);
        setAudioReady(true);
      })
      .catch((error: unknown) => {
        setAudioError(
          describeMobileAudioError(error),
        );
        setAudioReady(false);
      })
      .finally(() => {
        mediaStartingRef.current = false;
        setAudioBusy(false);
      });
  }, [audioArmed, audioReady, state.realtimeState]);

  async function handleCheckServer(): Promise<void> {
    setState((current) => ({
      ...current,
      serverError: undefined,
      serverLoading: true,
    }));

    try {
      const shell = await loadMobileServerShell(fetch, serverUrlInput);

      updateServerUrlInput(shell.baseUrl);
      setState((current) => ({
        ...current,
        discovery: shell.discovery,
        serverBaseUrl: shell.baseUrl,
        serverError: undefined,
        serverLoading: false,
        status: shell.status,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        serverError: error instanceof Error ? error.message : "CueCommX could not reach that server.",
        serverLoading: false,
      }));
    }
  }

  async function handleOpenQrScanner(): Promise<void> {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) return;
    }
    qrScannedRef.current = false;
    setQrScanOpen(true);
  }

  function handleQrScanned(data: string): void {
    if (qrScannedRef.current) return;
    qrScannedRef.current = true;
    setQrScanOpen(false);

    const url = data.trim();
    updateServerUrlInput(url);
    void handleCheckServerUrl(url);
  }

  async function handleCheckServerUrl(url: string): Promise<void> {
    setState((current) => ({
      ...current,
      serverError: undefined,
      serverLoading: true,
    }));

    try {
      const shell = await loadMobileServerShell(fetch, url);
      updateServerUrlInput(shell.baseUrl);
      setState((current) => ({
        ...current,
        discovery: shell.discovery,
        serverBaseUrl: shell.baseUrl,
        serverError: undefined,
        serverLoading: false,
        status: shell.status,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        serverError: error instanceof Error ? error.message : "CueCommX could not reach that server.",
        serverLoading: false,
      }));
    }
  }

  async function handleLogin(): Promise<void> {
    setState((current) => ({
      ...current,
      loginError: undefined,
      loginPending: true,
      operatorState: undefined,
      realtimeError: undefined,
      realtimeState: "connecting",
      serverError: undefined,
      serverLoading: true,
    }));

    try {
      const shell = await loadMobileServerShell(fetch, serverUrlInput);
      const payload = await loginMobileOperator(fetch, {
        pin,
        serverUrl: shell.baseUrl,
        username,
      });

      updateServerUrlInput(shell.baseUrl);

      // Apply server-stored preferences if they exist
      const serverPrefs = payload.preferences;
      if (serverPrefs && typeof serverPrefs === "object" && Object.keys(serverPrefs).length > 0) {
        const sp = serverPrefs as Record<string, unknown>;
        if (typeof sp.masterVolume === "number") setMasterVolume(sp.masterVolume as number);
        if (sp.channelVolumes && typeof sp.channelVolumes === "object") setChannelVolumes(sp.channelVolumes as Record<string, number>);
        if (Array.isArray(sp.latchModeChannelIds)) {
          const ids = sp.latchModeChannelIds as string[];
          setTalkMode(ids.length > 0 ? "latched" : "momentary");
        }
      }

      setState((current) => ({
        ...current,
        discovery: shell.discovery,
        loginError: undefined,
        loginPending: false,
        realtimeError: undefined,
        realtimeState: "connecting",
        serverBaseUrl: shell.baseUrl,
        serverLoading: false,
        session: payload,
        status: shell.status,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        loginError: error instanceof Error ? error.message : "CueCommX could not sign in.",
        loginPending: false,
        realtimeState: "idle",
        serverLoading: false,
      }));
    }
  }

  function handleSignOut(): void {
    setState((current) => ({
      ...current,
      loginError: undefined,
      operatorState: undefined,
      realtimeError: undefined,
      realtimeState: "idle",
      session: undefined,
    }));
    setAndroidBackgroundAlertActive(false);
    setAudioArmed(false);
    setAudioBusy(false);
    setAudioError(undefined);
    setAudioReady(false);
    setChannelVolumes({});
    setConnectionQuality(null);
    setHapticsAvailable(true);
    setInputLevel(0);
    setMasterVolume(100);
    setRemoteTalkers([]);
    setRuntimeNotice(undefined);
    setAllPageActive(undefined);
    setIncomingSignals([]);
    setOnlineUsers([]);
    setDirectCall(null);
    setIncomingCall(null);
    setGroups([]);
    setActiveGroupId(undefined);
    setIFBState(null);
    setVoxEnabled(false);
    setPreflightStep("idle");
    setPreflightPassed(undefined);
    setProfileNotice(undefined);
  }

  async function handleSaveProfile(): Promise<void> {
    if (!state.session || !state.serverBaseUrl) return;
    setProfileSaving(true);
    setProfileNotice(undefined);
    try {
      const prefs = {
        masterVolume,
        channelVolumes,
        audioProcessing,
        activeGroupId,
      };
      const res = await fetch(`${state.serverBaseUrl}api/preferences`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${state.session.sessionToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(prefs),
      });
      if (!res.ok) throw new Error("Failed to save profile");
      setProfileNotice("Profile saved");
      setTimeout(() => setProfileNotice(undefined), 3000);
    } catch (error) {
      setProfileNotice(error instanceof Error ? error.message : "Save failed");
    } finally {
      setProfileSaving(false);
    }
  }

  function handleDisconnect(): void {
    handleSignOut();
    setState((current) => ({
      ...current,
      discovery: undefined,
      serverBaseUrl: undefined,
      serverError: undefined,
      status: undefined,
    }));
  }

  async function handleArmAudio(): Promise<void> {
    if (
      !canArmMobileAudio({
        hasSession: !!state.session,
        realtimeState: state.realtimeState,
      }) ||
      !mediaControllerRef.current
    ) {
      setAudioError("CueCommX needs a live session before mobile audio can start.");
      return;
    }

    try {
      await configureMobileAudioSession();

      if (Platform.OS === "android") {
        const notificationsEnabled = await ensureAndroidRuntimeSupport();

        setRuntimeNotice((current) =>
          notificationsEnabled
            ? current === ANDROID_NOTIFICATION_GUIDANCE
              ? undefined
              : current
            : ANDROID_NOTIFICATION_GUIDANCE,
        );
      } else {
        setRuntimeNotice(undefined);
      }

      setAudioArmed(true);
      setAudioError(undefined);
    } catch (error) {
      setAudioError(
        getRuntimeMessage(error, "CueCommX could not configure the mobile audio session."),
      );
    }
  }

  function requireRealtimeConnection(): CueCommXRealtimeClient | undefined {
    if (state.realtimeState !== "connected" || !realtimeClientRef.current) {
      setState((current) => ({
        ...current,
        realtimeError: "CueCommX needs a live session before mobile controls can change.",
      }));
      return undefined;
    }

    return realtimeClientRef.current;
  }

  function sendChatMessage(channelId: string): void {
    const text = chatInput.trim();
    const realtimeClient = realtimeClientRef.current;

    if (!text || !realtimeClient) {
      return;
    }

    realtimeClient.sendChatMessage(channelId, text);
    setChatInput("");
  }

  function openChat(channelId: string): void {
    setChatOpen(channelId);
    setUnreadCounts((prev) => {
      const next = { ...prev };
      delete next[channelId];
      return next;
    });
  }

  function formatRelativeTime(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) {
      return "now";
    }

    const minutes = Math.floor(seconds / 60);

    if (minutes < 60) {
      return `${minutes}m ago`;
    }

    const hours = Math.floor(minutes / 60);

    if (hours < 24) {
      return `${hours}h ago`;
    }

    return `${Math.floor(hours / 24)}d ago`;
  }

  function handleToggleListen(channelId: string, listening: boolean): void {
    const realtimeClient = requireRealtimeConnection();

    if (!realtimeClient) {
      return;
    }

    try {
      realtimeClient.toggleListen(channelId, listening);
      setState((current) => ({
        ...current,
        realtimeError: undefined,
      }));
      queueHapticFeedback(() => triggerListenToggleHaptic());
    } catch (error) {
      setState((current) => ({
        ...current,
        realtimeError:
          error instanceof Error ? error.message : "CueCommX could not update mobile listen state.",
      }));
    }
  }

  function handleTalkGesture(channelId: string, phase: "press-in" | "press-out" | "tap"): void {
    if (!audioReady) {
      setAudioError("Arm mobile audio before starting Talk.");
      return;
    }

    const realtimeClient = requireRealtimeConnection();

    if (!realtimeClient) {
      return;
    }

    const isTalking = state.operatorState?.talkChannelIds.includes(channelId) ?? false;
    const action = resolveTalkGesture({
      isTalking,
      mode: talkMode,
      phase,
    });

    if (!action) {
      return;
    }

    try {
      if (action === "start") {
        realtimeClient.startTalk([channelId]);
      } else {
        realtimeClient.stopTalk([channelId]);
      }

      setState((current) => ({
        ...current,
        realtimeError: undefined,
      }));
      queueHapticFeedback(() => triggerTalkHaptic(action));
    } catch (error) {
      setState((current) => ({
        ...current,
        realtimeError:
          error instanceof Error ? error.message : "CueCommX could not update mobile talk state.",
      }));
    }
  }

  async function handleOpenBatterySettings(): Promise<void> {
    try {
      await openAndroidBatteryOptimizationSettings();
      setRuntimeNotice(undefined);
    } catch (error) {
      setRuntimeNotice(
        getRuntimeMessage(error, "CueCommX could not open Android battery optimization settings."),
      );
    }
  }

  function handleToggleAllPage(): void {
    const client = requireRealtimeConnection();
    if (!client) return;

    if (allPageActive && allPageActive.userId === state.session?.user.id) {
      client.stopAllPage();
    } else if (!allPageActive) {
      client.startAllPage();
    }
  }

  function requestDirectCallHandler(targetUserId: string): void {
    if (directCall || incomingCall) return;

    realtimeClientRef.current?.requestDirectCall(targetUserId);
    const targetUser = onlineUsers.find((u) => u.id === targetUserId);

    setDirectCall({
      callId: "",
      peerUserId: targetUserId,
      peerUsername: targetUser?.username ?? "Unknown",
      state: "requesting",
    });
  }

  function acceptIncomingCallHandler(): void {
    if (!incomingCall) return;
    realtimeClientRef.current?.acceptDirectCall(incomingCall.callId);
  }

  function rejectIncomingCallHandler(): void {
    if (!incomingCall) return;
    realtimeClientRef.current?.rejectDirectCall(incomingCall.callId);
    setIncomingCall(null);
  }

  function endCurrentDirectCall(): void {
    if (!directCall) return;
    realtimeClientRef.current?.endDirectCall(directCall.callId);
    setDirectCall(null);
  }

  function handleStartIFB(targetUserId: string): void {
    realtimeClientRef.current?.startIFB(targetUserId);
  }

  function handleStopIFB(): void {
    realtimeClientRef.current?.stopIFB();
  }

  function handleTestMic(): void {
    setPreflightStep("recording");
    setPreflightPassed(undefined);
    let maxLevel = 0;
    const startTime = Date.now();

    const interval = setInterval(() => {
      const current = inputLevel;
      if (current > maxLevel) maxLevel = current;

      if (Date.now() - startTime >= 3000) {
        clearInterval(interval);
        const passed = maxLevel > 10;
        setPreflightPassed(passed);
        setPreflightStep("done");
        realtimeClientRef.current?.reportPreflightResult(passed ? "passed" : "failed");
      }
    }, 100);
  }

  const isAllPageByOther = allPageActive !== undefined && allPageActive.userId !== state.session?.user.id;
  const isAdminOrOperator = state.session?.user.role === "admin" || state.session?.user.role === "operator";

  const voxHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voxTalkingRef = useRef(false);

  const startTalkAll = useCallback(() => {
    const client = realtimeClientRef.current;
    if (!client || !audioReady) return;

    const talkableChannelIds = assignedPermissions
      .filter((p) => p.canTalk)
      .map((p) => p.channelId);
    if (talkableChannelIds.length > 0) {
      client.startTalk(talkableChannelIds);
    }
  }, [audioReady, assignedPermissions]);

  const stopTalkAll = useCallback(() => {
    const client = realtimeClientRef.current;
    if (!client) return;

    const talkableChannelIds = assignedPermissions
      .filter((p) => p.canTalk)
      .map((p) => p.channelId);
    if (talkableChannelIds.length > 0) {
      client.stopTalk(talkableChannelIds);
    }
  }, [assignedPermissions]);

  useEffect(() => {
    if (!voxEnabled || !audioReady) {
      if (voxTalkingRef.current) {
        stopTalkAll();
        voxTalkingRef.current = false;
      }
      if (voxHoldTimerRef.current) {
        clearTimeout(voxHoldTimerRef.current);
        voxHoldTimerRef.current = null;
      }
      return;
    }

    if (inputLevel >= voxThreshold) {
      if (voxHoldTimerRef.current) {
        clearTimeout(voxHoldTimerRef.current);
        voxHoldTimerRef.current = null;
      }
      if (!voxTalkingRef.current) {
        voxTalkingRef.current = true;
        startTalkAll();
      }
    } else if (voxTalkingRef.current && !voxHoldTimerRef.current) {
      voxHoldTimerRef.current = setTimeout(() => {
        voxTalkingRef.current = false;
        voxHoldTimerRef.current = null;
        stopTalkAll();
      }, 500);
    }
  }, [inputLevel, voxEnabled, voxThreshold, audioReady, startTalkAll, stopTalkAll]);


  const screen = state.session ? "intercom" : state.status ? "login" : "connect";

  return (
    <SafeAreaProvider>
      <SafeAreaView className="flex-1 bg-background">
        <StatusBar style="light" />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1"
        >
          {screen === "connect" ? (
            <>
              {/* QR Scanner Modal */}
              <Modal
                animationType="slide"
                onRequestClose={() => setQrScanOpen(false)}
                presentationStyle="fullScreen"
                visible={qrScanOpen}
              >
                <View className="flex-1 bg-black">
                  <SafeAreaView className="flex-1">
                    <View className="flex-row items-center justify-between px-5 py-4">
                      <Text className="text-lg font-semibold text-white">Scan QR Code</Text>
                      <Pressable
                        accessibilityLabel="Close scanner"
                        className="rounded-full bg-white/15 px-4 py-2"
                        onPress={() => setQrScanOpen(false)}
                      >
                        <Text className="text-sm font-medium text-white">Cancel</Text>
                      </Pressable>
                    </View>

                    <View className="flex-1 items-center justify-center gap-6 px-8">
                      <View className="w-full overflow-hidden rounded-2xl" style={{ aspectRatio: 1 }}>
                        <CameraView
                          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                          className="flex-1"
                          facing="back"
                          onBarcodeScanned={({ data }) => handleQrScanned(data)}
                        />
                      </View>
                      <Text className="text-center text-sm leading-6 text-white/70">
                        Point your camera at the QR code on the{"\n"}CueCommX admin dashboard.
                      </Text>
                    </View>
                  </SafeAreaView>
                </View>
              </Modal>

              <ScrollView
                className="flex-1"
                contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View className="gap-8 px-6 py-10">
                  {/* Header */}
                  <View className="items-center gap-4">
                    <View className="h-16 w-16 items-center justify-center rounded-2xl bg-primary/15">
                      <Text className="text-3xl">{String.fromCodePoint(0x1f399)}</Text>
                    </View>
                    <Text className="text-3xl font-bold tracking-tight text-foreground">
                      CueCommX
                    </Text>
                    <Text className="max-w-xs text-center text-base leading-6 text-muted-foreground">
                      Connect to your local intercom server to get started.
                    </Text>
                  </View>

                  {/* mDNS Discovered Servers */}
                  {(discoveredServers.length > 0 || discoveryScanning) ? (
                    <View className="gap-3">
                      <View className="flex-row items-center gap-2">
                        <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                          Nearby Servers
                        </Text>
                        {discoveryScanning ? (
                          <ActivityIndicator color="#738094" size="small" />
                        ) : null}
                      </View>

                      {discoveredServers.map((server) => (
                        <Pressable
                          accessibilityLabel={`Connect to ${server.name}`}
                          accessibilityRole="button"
                          className="flex-row items-center gap-4 rounded-xl border border-border bg-card p-4 active:opacity-70"
                          key={server.id}
                          onPress={() => void handleCheckServerUrl(server.url)}
                        >
                          <View className="h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
                            <Text className="text-xl">{String.fromCodePoint(0x1f4e1)}</Text>
                          </View>
                          <View className="flex-1 gap-0.5">
                            <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                              {server.name}
                            </Text>
                            <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                              {server.url}
                            </Text>
                          </View>
                          <Text className="text-muted-foreground">{String.fromCodePoint(0x203a)}</Text>
                        </Pressable>
                      ))}

                      {discoveredServers.length === 0 && discoveryScanning ? (
                        <View className="rounded-xl border border-border bg-card/50 p-4">
                          <Text className="text-center text-sm text-muted-foreground">
                            Scanning for servers on your network…
                          </Text>
                        </View>
                      ) : null}

                      <View className="flex-row items-center gap-3">
                        <View className="h-px flex-1 bg-border" />
                        <Text className="text-xs text-muted-foreground">or enter manually</Text>
                        <View className="h-px flex-1 bg-border" />
                      </View>
                    </View>
                  ) : null}

                  {/* Manual Entry */}
                  <View className="gap-4">
                    <View className="gap-2">
                      <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                        Server address
                      </Text>
                      <TextInput
                        accessibilityLabel="Server URL"
                        autoCapitalize="none"
                        autoCorrect={false}
                        className={inputClassName}
                        keyboardType="url"
                        onChangeText={updateServerUrlInput}
                        onSubmitEditing={() => void handleCheckServer()}
                        placeholder="192.168.1.100:3000"
                        placeholderTextColor="#738094"
                        returnKeyType="go"
                        value={serverUrlInput}
                      />
                    </View>

                    <View className="flex-row gap-3">
                      <View className="flex-1">
                        <ActionButton
                          disabled={state.serverLoading || !serverUrlInput.trim()}
                          label={state.serverLoading ? "Connecting..." : "Connect"}
                          onPress={() => void handleCheckServer()}
                        />
                      </View>
                      <Pressable
                        accessibilityLabel="Scan QR code"
                        accessibilityRole="button"
                        className="h-12 w-12 items-center justify-center rounded-xl border border-border bg-card active:opacity-70"
                        onPress={() => void handleOpenQrScanner()}
                      >
                        <Text className="text-xl">{String.fromCodePoint(0x1f4f7)}</Text>
                      </Pressable>
                    </View>
                  </View>

                  {state.serverError ? (
                    <View className="rounded-xl border border-destructive/30 bg-destructive/10 p-4">
                      <Text className="text-sm leading-6 text-destructive">{state.serverError}</Text>
                    </View>
                  ) : null}

                  <Text className="text-center text-xs leading-5 text-muted-foreground">
                    Tap a nearby server, scan the admin QR code, or enter the IP address.{"\n"}
                    LAN-only — no cloud relay required.
                  </Text>
                </View>
              </ScrollView>
            </>
          ) : screen === "login" ? (
            <ScrollView
              className="flex-1"
              contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View className="gap-8 px-6 py-10">
                <View className="items-center gap-4">
                  <View className="rounded-full border border-success/30 bg-success/10 px-4 py-2">
                    <Text className="text-xs font-semibold text-success">
                      {String.fromCodePoint(0x25cf)} {state.status?.name ?? "Server connected"}
                    </Text>
                  </View>
                  <Text className="text-2xl font-bold tracking-tight text-foreground">
                    Sign in
                  </Text>
                  <Text className="max-w-xs text-center text-base leading-6 text-muted-foreground">
                    Enter your operator credentials to join the intercom.
                  </Text>
                </View>

                <View className="gap-4">
                  <View className="gap-2">
                    <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                      Username
                    </Text>
                    <TextInput
                      accessibilityLabel="Username"
                      autoCapitalize="none"
                      autoCorrect={false}
                      className={inputClassName}
                      onChangeText={setUsername}
                      placeholder="audio1"
                      placeholderTextColor="#738094"
                      returnKeyType="next"
                      value={username}
                    />
                  </View>

                  <View className="gap-2">
                    <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                      PIN (optional)
                    </Text>
                    <TextInput
                      accessibilityLabel="PIN"
                      autoCapitalize="none"
                      autoCorrect={false}
                      className={inputClassName}
                      onChangeText={setPin}
                      onSubmitEditing={() => void handleLogin()}
                      placeholder="PIN"
                      placeholderTextColor="#738094"
                      returnKeyType="go"
                      secureTextEntry
                      value={pin}
                    />
                  </View>

                  <ActionButton
                    disabled={state.loginPending || !username.trim()}
                    label={state.loginPending ? "Joining..." : "Join intercom"}
                    onPress={() => void handleLogin()}
                  />
                </View>

                {state.loginPending ? (
                  <View className="flex-row items-center gap-3 rounded-xl border border-border bg-background/60 p-4">
                    <ActivityIndicator color="#5eead4" />
                    <Text className="flex-1 text-sm leading-6 text-muted-foreground">
                      Authenticating and opening the realtime session\u2026
                    </Text>
                  </View>
                ) : null}

                {state.loginError ? (
                  <View className="rounded-xl border border-destructive/30 bg-destructive/10 p-4">
                    <Text className="text-sm leading-6 text-destructive">{state.loginError}</Text>
                  </View>
                ) : null}

                <Pressable className="items-center py-2" onPress={handleDisconnect}>
                  <Text className="text-sm font-medium text-muted-foreground">
                    {String.fromCodePoint(0x2190)} Change server
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          ) : (
            <View className="flex-1">
              <View className="border-b border-border bg-card/90 px-5 py-3">
                <View className="flex-row items-center justify-between">
                  <View className="flex-1 gap-0.5">
                    <View className="flex-row items-center gap-2">
                      <Text className="text-lg font-semibold text-foreground">
                        {state.session!.user.username}
                      </Text>
                      <View className="rounded-full border border-border bg-secondary/70 px-2 py-0.5">
                        <Text className="text-[10px] font-semibold uppercase tracking-control text-muted-foreground">
                          {state.session!.user.role === "admin"
                            ? "Admin"
                            : state.session!.user.role === "operator"
                              ? "Operator"
                              : "User"}
                        </Text>
                      </View>
                    </View>
                    <View className="flex-row items-center gap-2">
                      <Text className="text-xs text-muted-foreground">
                        {state.status?.name ?? "CueCommX"}
                      </Text>
                      {connectionQuality ? (
                        <Text className="text-xs text-muted-foreground">
                          {connectionQuality.grade === "good" || connectionQuality.grade === "excellent"
                            ? String.fromCodePoint(0x1f7e2)
                            : connectionQuality.grade === "fair"
                              ? String.fromCodePoint(0x1f7e1)
                              : String.fromCodePoint(0x1f534)}{" "}
                          RTT: {Math.round(connectionQuality.roundTripTimeMs)}ms
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  <View className={`rounded-full px-3 py-1 ${connectionBadge.toneClassName}`}>
                    <Text className="text-[10px] font-semibold uppercase tracking-control">
                      {connectionBadge.label}
                    </Text>
                  </View>
                </View>
              </View>

              {tallySources.some((s) => s.state !== "none") ? (
                <View className="border-b border-border bg-card/60 px-5 py-2">
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View className="flex-row items-center gap-2">
                      <Text className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        TALLY
                      </Text>
                      {tallySources
                        .filter((s) => s.state === "program")
                        .map((s) => (
                          <View
                            className="flex-row items-center gap-1 rounded-md bg-destructive px-2 py-0.5"
                            key={s.sourceId}
                          >
                            <Text className="text-[10px] font-bold text-destructive-foreground">
                              🔴 PGM: {s.sourceName}
                            </Text>
                          </View>
                        ))}
                      {tallySources
                        .filter((s) => s.state === "preview")
                        .map((s) => (
                          <View
                            className="flex-row items-center gap-1 rounded-md bg-success px-2 py-0.5"
                            key={s.sourceId}
                          >
                            <Text className="text-[10px] font-bold text-success-foreground">
                              🟢 PVW: {s.sourceName}
                            </Text>
                          </View>
                        ))}
                    </View>
                  </ScrollView>
                </View>
              ) : null}

              <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
                <View className="gap-4 px-5 pb-10 pt-4">
                  {state.realtimeError ? (
                    <View className="rounded-xl border border-warning/30 bg-warning/10 p-4">
                      <Text className="text-sm leading-6 text-warning">{state.realtimeError}</Text>
                    </View>
                  ) : null}

                  <SectionCard>
                    <View className="flex-row items-center justify-between">
                      <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                        Audio
                      </Text>
                      <Text className="text-xs font-semibold text-foreground">{audioStatusLabel}</Text>
                    </View>

                    <ActionButton
                      disabled={
                        audioBusy ||
                        audioReady ||
                        !canArmMobileAudio({
                          hasSession: !!state.session,
                          realtimeState: state.realtimeState,
                        })
                      }
                      label={
                        audioReady
                          ? "Audio live"
                          : audioBusy
                            ? "Arming..."
                            : audioArmed
                              ? "Retry audio"
                              : "Arm audio"
                      }
                      onPress={() => void handleArmAudio()}
                      tone={audioReady ? "secondary" : "primary"}
                    />

                    <View className="gap-2">
                      <View className="flex-row items-center justify-between">
                        <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                          Mic level
                        </Text>
                        <Text className="text-xs font-semibold text-foreground">{inputLevel}%</Text>
                      </View>
                      <View className="h-3 overflow-hidden rounded-full bg-secondary/80">
                        <View
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${audioReady ? Math.max(4, inputLevel) : 0}%` }}
                        />
                      </View>
                    </View>

                    <View className="gap-2">
                      <View className="flex-row items-center justify-between">
                        <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                          Master volume
                        </Text>
                        <Text className="text-xs font-semibold text-foreground">{masterVolume}%</Text>
                      </View>
                      <Slider
                        maximumTrackTintColor="#334155"
                        maximumValue={100}
                        minimumTrackTintColor="#5eead4"
                        minimumValue={0}
                        onValueChange={setMasterVolume}
                        step={5}
                        thumbTintColor="#5eead4"
                        value={masterVolume}
                      />
                    </View>

                    {showAndroidRuntimeSupport ? (
                      <DetailRow
                        label="Background alert"
                        value={androidBackgroundAlertActive ? "Active" : "Standby"}
                      />
                    ) : null}

                    {audioError ? (
                      <View className="rounded-xl border border-warning/30 bg-warning/10 p-4">
                        <Text className="text-sm leading-6 text-warning">{audioError}</Text>
                      </View>
                    ) : null}

                    {runtimeNotice ? (
                      <View className="rounded-xl border border-warning/30 bg-warning/10 p-4">
                        <Text className="text-sm leading-6 text-warning">{runtimeNotice}</Text>
                      </View>
                    ) : null}

                    {remoteTalkers.length ? (
                      <View className="gap-2">
                        <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                          Remote talkers
                        </Text>
                        {remoteTalkers.map((talker) => (
                          <Text className="text-sm leading-6 text-foreground" key={talker.consumerId}>
                            {talker.producerUsername}:{" "}
                            {talker.activeChannelIds
                              .map(
                                (channelId) =>
                                  activeChannels.find((channel) => channel.id === channelId)?.name ?? channelId,
                              )
                              .join(", ")}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                  </SectionCard>

                  {showAndroidRuntimeSupport ? (
                    <SectionCard>
                      <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                        Android runtime
                      </Text>
                      <Text className="text-sm leading-6 text-muted-foreground">
                        Allow CueCommX notifications and exempt the app from battery optimization
                        for reliable background audio.
                      </Text>
                      <ActionButton
                        label="Open battery settings"
                        onPress={() => void handleOpenBatterySettings()}
                        tone="secondary"
                      />
                    </SectionCard>
                  ) : null}

                  <SectionCard>
                    <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                      Talk mode
                    </Text>
                    <View className="flex-row gap-3">
                      <ActionButton
                        disabled={talkMode === "momentary"}
                        label="Momentary"
                        onPress={() => {
                          setTalkMode("momentary");
                          queueHapticFeedback(() => triggerTalkHaptic("mode"));
                        }}
                        tone={talkMode === "momentary" ? "primary" : "secondary"}
                      />
                      <ActionButton
                        disabled={talkMode === "latched"}
                        label="Latched"
                        onPress={() => {
                          setTalkMode("latched");
                          queueHapticFeedback(() => triggerTalkHaptic("mode"));
                        }}
                        tone={talkMode === "latched" ? "primary" : "secondary"}
                      />
                    </View>
                    <Text className="text-sm leading-6 text-muted-foreground">
                      Momentary uses hold-to-talk. Latched turns the Talk button into a toggle for
                      one-handed operation.
                    </Text>
                    <View className="flex-row items-center justify-between">
                      <Text className="text-sm text-foreground">VOX (auto-talk)</Text>
                      <Switch
                        trackColor={{ false: "#334155", true: "#5eead4" }}
                        thumbColor="#ffffff"
                        value={voxEnabled}
                        onValueChange={setVoxEnabled}
                      />
                    </View>
                    {voxEnabled ? (
                      <View className="gap-2">
                        <View className="flex-row items-center justify-between">
                          <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                            VOX threshold
                          </Text>
                          <Text className="text-xs font-semibold text-foreground">{voxThreshold}%</Text>
                        </View>
                        <Slider
                          maximumTrackTintColor="#334155"
                          maximumValue={50}
                          minimumTrackTintColor="#5eead4"
                          minimumValue={5}
                          onValueChange={(value) => setVoxThreshold(Math.round(value))}
                          step={1}
                          thumbTintColor="#5eead4"
                          value={voxThreshold}
                        />
                        <Text className="text-sm leading-6 text-muted-foreground">
                          VOX activates talk on all assigned channels when mic level exceeds threshold.
                        </Text>
                      </View>
                    ) : null}
                  </SectionCard>

                  <SectionCard>
                    <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                      Preflight mic test
                    </Text>
                    <ActionButton
                      disabled={preflightStep === "recording" || !audioReady}
                      label={
                        preflightStep === "recording"
                          ? "Testing mic..."
                          : "Test Mic"
                      }
                      onPress={handleTestMic}
                      tone="secondary"
                    />
                    {preflightStep === "recording" ? (
                      <View className="rounded-xl border border-primary/30 bg-primary/10 p-3">
                        <Text className="text-sm text-primary">
                          {String.fromCodePoint(0x1f399)} Recording — speak into your mic...
                        </Text>
                        <View className="mt-2 h-3 overflow-hidden rounded-full bg-secondary/80">
                          <View
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${Math.max(4, inputLevel)}%` }}
                          />
                        </View>
                      </View>
                    ) : null}
                    {preflightStep === "done" && preflightPassed === true ? (
                      <View className="rounded-xl border border-success/30 bg-success/10 p-3">
                        <Text className="text-sm text-success">
                          {String.fromCodePoint(0x2713)} Mic test passed
                        </Text>
                      </View>
                    ) : null}
                    {preflightStep === "done" && preflightPassed === false ? (
                      <View className="rounded-xl border border-destructive/30 bg-destructive/10 p-3">
                        <Text className="text-sm text-destructive">
                          {String.fromCodePoint(0x2717)} Mic test failed — no audio detected
                        </Text>
                      </View>
                    ) : null}
                  </SectionCard>

                  <SectionCard>
                    <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                      Audio processing
                    </Text>
                    <View className="gap-3">
                      <View className="flex-row items-center justify-between">
                        <Text className="text-sm text-foreground">Noise suppression</Text>
                        <Switch
                          trackColor={{ false: "#334155", true: "#5eead4" }}
                          thumbColor="#ffffff"
                          value={audioProcessing.noiseSuppression}
                          onValueChange={(value) =>
                            setAudioProcessing((current) => ({ ...current, noiseSuppression: value }))
                          }
                        />
                      </View>
                      <View className="flex-row items-center justify-between">
                        <Text className="text-sm text-foreground">Auto gain control</Text>
                        <Switch
                          trackColor={{ false: "#334155", true: "#5eead4" }}
                          thumbColor="#ffffff"
                          value={audioProcessing.autoGainControl}
                          onValueChange={(value) =>
                            setAudioProcessing((current) => ({ ...current, autoGainControl: value }))
                          }
                        />
                      </View>
                      <View className="flex-row items-center justify-between">
                        <Text className="text-sm text-foreground">Echo cancellation</Text>
                        <Switch
                          trackColor={{ false: "#334155", true: "#5eead4" }}
                          thumbColor="#ffffff"
                          value={audioProcessing.echoCancellation}
                          onValueChange={(value) =>
                            setAudioProcessing((current) => ({ ...current, echoCancellation: value }))
                          }
                        />
                      </View>
                    </View>
                    <Text className="text-sm leading-6 text-muted-foreground">
                      Audio processing takes effect the next time audio is armed.
                    </Text>
                  </SectionCard>

                  <SectionCard>
                    <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                      Audio ducking
                    </Text>
                    <View className="flex-row items-center justify-between">
                      <Text className="text-sm text-foreground">Auto-ducking</Text>
                      <Switch
                        trackColor={{ false: "#334155", true: "#5eead4" }}
                        thumbColor="#ffffff"
                        value={duckingEnabled}
                        onValueChange={setDuckingEnabled}
                      />
                    </View>
                    <Text className="text-sm leading-6 text-muted-foreground">
                      Automatically reduce lower-priority channel volume when a higher-priority channel is active.
                    </Text>
                  </SectionCard>

                  <SectionCard>
                    <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                      Web-only features
                    </Text>
                    <Text className="text-sm leading-6 text-muted-foreground">
                      Sidetone (mic monitor), split-ear stereo panning, and headset button PTT are available on the web client only. Native headset button support is planned for a future release.
                    </Text>
                  </SectionCard>

                  <SectionCard>
                    <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                      User profile
                    </Text>
                    <ActionButton
                      disabled={profileSaving || !state.session}
                      label={profileSaving ? "Saving…" : "Save profile to server"}
                      onPress={() => void handleSaveProfile()}
                      tone="secondary"
                    />
                    {profileNotice ? (
                      <Text className="text-center text-xs text-muted-foreground">{profileNotice}</Text>
                    ) : null}
                    <Text className="text-sm leading-6 text-muted-foreground">
                      Save your current volume, processing, and group settings to the server. Settings load automatically on next login.
                    </Text>
                  </SectionCard>

                  {isAdminOrOperator ? (
                    <SectionCard>
                      <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                        All-Page
                      </Text>
                      <ActionButton
                        disabled={isAllPageByOther}
                        label={
                          allPageActive && allPageActive.userId === state.session?.user.id
                            ? "Stop All-Page"
                            : allPageActive
                              ? "All-Page in use"
                              : "Start All-Page"
                        }
                        onPress={handleToggleAllPage}
                        tone={allPageActive && allPageActive.userId === state.session?.user.id ? "secondary" : "primary"}
                      />
                    </SectionCard>
                  ) : null}

                  {allPageActive ? (
                    <View className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3">
                      <Text className="text-sm font-medium text-amber-400">
                        {String.fromCodePoint(0x1f4e2)} All-Page by {allPageActive.username}
                      </Text>
                    </View>
                  ) : null}

                  {incomingSignals.map((signal) => {
                    const colorClass =
                      signal.signalType === "call"
                        ? "border-red-500/50 bg-red-500/10"
                        : signal.signalType === "go"
                          ? "border-green-500/50 bg-green-500/10"
                          : "border-amber-500/50 bg-amber-500/10";
                    const textColor =
                      signal.signalType === "call"
                        ? "text-red-400"
                        : signal.signalType === "go"
                          ? "text-green-400"
                          : "text-amber-400";
                    const icon =
                      signal.signalType === "call"
                        ? String.fromCodePoint(0x1f4de)
                        : signal.signalType === "go"
                          ? String.fromCodePoint(0x1f7e2)
                          : String.fromCodePoint(0x23f3);

                    return (
                      <View className={`flex-row items-center gap-3 rounded-xl border px-4 py-3 ${colorClass}`} key={signal.signalId}>
                        <Text className={`flex-1 text-sm font-medium ${textColor}`}>
                          {icon} {signal.signalType.toUpperCase()} from {signal.fromUsername}
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          className="rounded-lg border border-border bg-secondary px-3 py-1.5"
                          onPress={() => realtimeClientRef.current?.acknowledgeSignal(signal.signalId)}
                        >
                          <Text className="text-xs font-semibold text-foreground">Ack</Text>
                        </Pressable>
                      </View>
                    );
                  })}

                  {groups.length > 0 ? (
                    <View className="gap-2">
                      <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                        Group
                      </Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View className="flex-row gap-2">
                          <Pressable
                            className={`rounded-lg px-3 py-1.5 ${
                              !activeGroupId
                                ? "bg-primary"
                                : "bg-secondary/50"
                            }`}
                            onPress={() => setActiveGroupId(undefined)}
                          >
                            <Text className={`text-sm font-medium ${
                              !activeGroupId ? "text-primary-foreground" : "text-foreground"
                            }`}>
                              All
                            </Text>
                          </Pressable>
                          {groups.map((group) => (
                            <Pressable
                              className={`rounded-lg px-3 py-1.5 ${
                                activeGroupId === group.id
                                  ? "bg-primary"
                                  : "bg-secondary/50"
                              }`}
                              key={group.id}
                              onPress={() => setActiveGroupId(group.id)}
                            >
                              <Text className={`text-sm font-medium ${
                                activeGroupId === group.id ? "text-primary-foreground" : "text-foreground"
                              }`}>
                                {group.name}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      </ScrollView>
                    </View>
                  ) : null}

                  {incomingCall ? (
                    <View className="flex-row items-center gap-3 rounded-xl border border-blue-500/50 bg-blue-500/10 px-4 py-3">
                      <Text className="flex-1 text-sm font-medium text-blue-400">
                        {String.fromCodePoint(0x1f4de)} Incoming call from {incomingCall.fromUsername}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        className="rounded-lg border border-success/40 bg-success/15 px-3 py-1.5"
                        onPress={acceptIncomingCallHandler}
                      >
                        <Text className="text-xs font-semibold text-success">Accept</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        className="rounded-lg border border-destructive/40 bg-destructive/15 px-3 py-1.5"
                        onPress={rejectIncomingCallHandler}
                      >
                        <Text className="text-xs font-semibold text-destructive">Reject</Text>
                      </Pressable>
                    </View>
                  ) : null}

                  {directCall ? (
                    <View className={`flex-row items-center gap-3 rounded-xl border px-4 py-3 ${
                      directCall.state === "active"
                        ? "border-green-500/50 bg-green-500/10"
                        : "border-blue-500/50 bg-blue-500/10"
                    }`}>
                      <Text className={`flex-1 text-sm font-medium ${
                        directCall.state === "active" ? "text-green-400" : "text-blue-400"
                      }`}>
                        {directCall.state === "active"
                          ? `${String.fromCodePoint(0x1f517)} Direct call with ${directCall.peerUsername}`
                          : `${String.fromCodePoint(0x1f4de)} Calling ${directCall.peerUsername}...`}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        className="rounded-lg border border-destructive/40 bg-destructive/15 px-3 py-1.5"
                        onPress={endCurrentDirectCall}
                      >
                        <Text className="text-xs font-semibold text-destructive">End Call</Text>
                      </Pressable>
                    </View>
                  ) : null}

                  {!directCall && !incomingCall && onlineUsers.length > 0 ? (
                    <SectionCard>
                      <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                        Direct call
                      </Text>
                      <View className="flex-row flex-wrap gap-2">
                        {onlineUsers
                          .filter((u) => u.id !== state.session?.user.id)
                          .map((user) => (
                            <Pressable
                              accessibilityRole="button"
                              className="rounded-lg border border-border bg-secondary px-3 py-2"
                              key={user.id}
                              onPress={() => requestDirectCallHandler(user.id)}
                            >
                              <Text className="text-sm font-medium text-foreground">
                                {String.fromCodePoint(0x1f4de)} {user.username}
                              </Text>
                            </Pressable>
                          ))}
                      </View>
                    </SectionCard>
                  ) : null}

                  {ifbState ? (
                    <View className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3">
                      <Text className="text-sm font-medium text-amber-400">
                        {String.fromCodePoint(0x1f3a7)} {ifbState.fromUsername} is speaking to you — program audio ducked
                      </Text>
                    </View>
                  ) : null}

                  {isAdminOrOperator && onlineUsers.length > 0 ? (
                    <SectionCard>
                      <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                        IFB controls
                      </Text>
                      <View className="flex-row flex-wrap gap-2">
                        {onlineUsers
                          .filter((u) => u.id !== state.session?.user.id)
                          .map((user) => (
                            <Pressable
                              accessibilityRole="button"
                              className="rounded-lg border border-border bg-secondary px-3 py-2"
                              key={user.id}
                              onPress={() => handleStartIFB(user.id)}
                            >
                              <Text className="text-sm font-medium text-foreground">
                                {String.fromCodePoint(0x1f3a7)} IFB → {user.username}
                              </Text>
                            </Pressable>
                          ))}
                        <Pressable
                          accessibilityRole="button"
                          className="rounded-lg border border-destructive/40 bg-destructive/15 px-3 py-2"
                          onPress={handleStopIFB}
                        >
                          <Text className="text-sm font-medium text-destructive">Stop IFB</Text>
                        </Pressable>
                      </View>
                    </SectionCard>
                  ) : null}

                  <View className="gap-3" style={isLandscape || isTablet ? { flexDirection: "row", flexWrap: "wrap" } : undefined}>
                    {visibleChannels.map((channel) => {
                      const permission = findPermission(assignedPermissions, channel.id);
                      const chInfo = channel as ChannelInfo;

                      return (
                        <View
                          key={channel.id}
                          style={
                            isTablet
                              ? { width: "31%", marginRight: "2%" }
                              : isLandscape
                                ? { width: "48%", marginRight: "2%" }
                                : undefined
                          }
                        >
                        <ChannelPermissionCard
                          channelType={chInfo.channelType}
                          connected={state.realtimeState === "connected"}
                          canListen={permission?.canListen ?? false}
                          canTalk={permission?.canTalk ?? false}
                          color={channel.color}
                          isAllPageBlocked={isAllPageByOther}
                          isGlobal={channel.isGlobal ?? false}
                          isListening={
                            state.operatorState?.listenChannelIds.includes(channel.id) ?? false
                          }
                          isRecording={recordingActiveIds.includes(channel.id)}
                          isSource={chInfo.sourceUserId === state.session?.user.id}
                          isTalking={state.operatorState?.talkChannelIds.includes(channel.id) ?? false}
                          isVoxMode={voxEnabled}
                          name={channel.name}
                          onChat={() => openChat(channel.id)}
                          onSignal={
                            isAdminOrOperator
                              ? (signalType) => realtimeClientRef.current?.sendCallSignal(signalType, { channelId: channel.id })
                              : undefined
                          }
                          onToggleListen={() =>
                            handleToggleListen(
                              channel.id,
                              !(state.operatorState?.listenChannelIds.includes(channel.id) ?? false),
                            )
                          }
                          onTalkPress={(phase) => handleTalkGesture(channel.id, phase)}
                          onVolumeChange={(value) =>
                            setChannelVolumes((current) => {
                              const rounded = Math.round(value);
                              if ((current[channel.id] ?? 100) === rounded) {
                                return current;
                              }
                              return { ...current, [channel.id]: rounded };
                            })
                          }
                          role={state.session?.user.role}
                          talkReady={audioReady}
                          talkMode={talkMode}
                          unreadCount={unreadCounts[channel.id] ?? 0}
                          volumePercent={channelVolumes[channel.id] ?? 100}
                        />
                        </View>
                      );
                    })}
                  </View>

                  {confidenceChannels.length > 0 ? (
                    <SectionCard>
                      <Text className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                        🎧 Confidence Feeds
                      </Text>
                      {confidenceChannels.map((channel) => {
                        const listening = state.operatorState?.listenChannelIds.includes(channel.id) ?? false;
                        const vol = channelVolumes[channel.id] ?? 100;
                        return (
                          <View key={channel.id} className="gap-2 pb-3">
                            <View className="flex-row items-center justify-between">
                              <View className="flex-row items-center gap-2">
                                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: channel.color }} />
                                <Text className="text-sm font-semibold text-foreground">{channel.name}</Text>
                              </View>
                              <Text className={`text-xs font-medium ${listening ? "text-primary" : "text-muted-foreground"}`}>
                                {listening ? "Listening" : "Idle"}
                              </Text>
                            </View>
                            <Text className="text-xs text-muted-foreground">
                              Always-on confidence monitor — exempt from ducking and IFB.
                            </Text>
                            <View className="flex-row items-center gap-2">
                              <Text className="text-xs text-muted-foreground">Vol</Text>
                              <Slider
                                minimumValue={0}
                                maximumValue={100}
                                step={1}
                                value={vol}
                                onValueChange={(value) =>
                                  setChannelVolumes((current) => {
                                    const rounded = Math.round(value);
                                    if ((current[channel.id] ?? 100) === rounded) return current;
                                    return { ...current, [channel.id]: rounded };
                                  })
                                }
                                style={{ flex: 1 }}
                                minimumTrackTintColor="#6366f1"
                                maximumTrackTintColor="#374151"
                              />
                              <Text className="w-8 text-right text-xs text-muted-foreground">{vol}%</Text>
                            </View>
                          </View>
                        );
                      })}
                    </SectionCard>
                  ) : null}

                  <View className="pt-4">
                    <ActionButton label="Sign out" onPress={handleSignOut} tone="secondary" />
                  </View>
                </View>
              </ScrollView>
            </View>
          )}
        </KeyboardAvoidingView>

        <Modal
          animationType="slide"
          onRequestClose={() => setChatOpen(null)}
          transparent={false}
          visible={chatOpen !== null}
        >
          <SafeAreaView className="flex-1 bg-background">
            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : "height"}
              className="flex-1"
            >
              <View className="flex-row items-center justify-between border-b border-border px-4 py-3">
                <View className="flex-row items-center gap-2">
                  <Text className="text-base">{String.fromCodePoint(0x1f4ac)}</Text>
                  <Text className="text-base font-semibold text-foreground">
                    {activeChannels.find((c) => c.id === chatOpen)?.name ?? chatOpen ?? "Chat"}
                  </Text>
                </View>
                <Pressable accessibilityRole="button" onPress={() => setChatOpen(null)}>
                  <Text className="text-sm font-semibold text-primary">Close</Text>
                </Pressable>
              </View>
              <FlatList<ChatMessagePayload>
                ref={chatListRef}
                className="flex-1 px-4"
                contentContainerStyle={{ paddingVertical: 12 }}
                data={chatOpen ? (chatMessages[chatOpen] ?? []) : []}
                keyExtractor={(item) => item.id}
                ListEmptyComponent={
                  <View className="items-center pt-8">
                    <Text className="text-sm text-muted-foreground">No messages yet. Start the conversation!</Text>
                  </View>
                }
                onContentSizeChange={() => chatListRef.current?.scrollToEnd({ animated: true })}
                renderItem={({ item }) => (
                  <View className={`mb-3 ${item.messageType === "system" ? "items-center" : ""}`}>
                    {item.messageType === "system" ? (
                      <Text className="text-xs italic text-muted-foreground">{item.text}</Text>
                    ) : (
                      <View>
                        <View className="flex-row items-baseline gap-2">
                          <Text className="text-xs font-semibold text-foreground">{item.username}</Text>
                          <Text className="text-[10px] text-muted-foreground">{formatRelativeTime(item.timestamp)}</Text>
                        </View>
                        <Text className="text-sm text-foreground">{item.text}</Text>
                      </View>
                    )}
                  </View>
                )}
              />
              <View className="flex-row items-center gap-2 border-t border-border px-4 py-3">
                <TextInput
                  className="flex-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground"
                  maxLength={500}
                  onChangeText={setChatInput}
                  onSubmitEditing={() => chatOpen && sendChatMessage(chatOpen)}
                  placeholder="Type a message..."
                  placeholderTextColor="#6b7280"
                  returnKeyType="send"
                  value={chatInput}
                />
                <Pressable
                  accessibilityRole="button"
                  className={`rounded-lg bg-primary px-4 py-2 ${!chatInput.trim() ? "opacity-50" : ""}`}
                  disabled={!chatInput.trim()}
                  onPress={() => chatOpen && sendChatMessage(chatOpen)}
                >
                  <Text className="text-sm font-semibold text-primary-foreground">Send</Text>
                </Pressable>
              </View>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
