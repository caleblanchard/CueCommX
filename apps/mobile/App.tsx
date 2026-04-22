import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { CameraView, useCameraPermissions } from "expo-camera";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Slider from "@react-native-community/slider";
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  FlatList,
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
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  ArrowLeft,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Globe,
  Headphones,
  Link,
  Megaphone,
  MessageCircle,
  Mic,
  Phone,
  Radio,
  Settings,
  Timer,
  Volume2,
  X,
  GripVertical,
  ListOrdered,
} from "lucide-react-native";

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
import { loadPersistedServerUrl, loadPersistedUsername, persistServerUrl, persistUsername } from "./src/server-url-storage";
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
  setMobileAudioOutput,
  type AudioOutputDevice,
} from "./src/mobile-runtime-native";
import {
  startLiveActivity,
  updateLiveActivity,
  endLiveActivity,
  addToggleTalkListener,
} from "cuecommx-live-activity";

import DraggableFlatList, { ScaleDecorator, type RenderItemParams } from "react-native-draggable-flatlist";

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

// Configure how incoming local notifications are displayed
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

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
        toneClassName: "border-amber-700 bg-amber-950 text-amber-300",
      };
    case "connecting":
      return {
        label: "Linking session",
        toneClassName: "border-primary/30 bg-primary/10 text-primary",
      };
    case "closed":
      return {
        label: "Disconnected",
        toneClassName: "border-amber-700 bg-amber-950 text-amber-300",
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
            <Globe accessibilityLabel="Global channel" color="#94a3b8" size={16} />
          ) : null}
          {isProgram ? (
            <View className="flex-row items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5">
              <Radio color="#fbbf24" size={10} />
              <Text className="text-[10px] font-semibold uppercase tracking-control text-amber-400">Program</Text>
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
                  <View className="flex-row items-center gap-2">
                  <Phone color="#f87171" size={14} />
                  <Text className="text-sm font-medium text-red-400">Call</Text>
                </View>
                </Pressable>
                <Pressable
                  className="rounded-lg px-3 py-2"
                  onPress={() => { onSignal("standby"); setSignalMenuOpen(false); }}
                >
                  <View className="flex-row items-center gap-2">
                  <Timer color="#fbbf24" size={14} />
                  <Text className="text-sm font-medium text-amber-400">Standby</Text>
                </View>
                </Pressable>
                <Pressable
                  className="rounded-lg px-3 py-2"
                  onPress={() => { onSignal("go"); setSignalMenuOpen(false); }}
                >
                  <View className="flex-row items-center gap-2">
                  <Check color="#4ade80" size={14} />
                  <Text className="text-sm font-medium text-green-400">Go</Text>
                </View>
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
          <View className="flex-row items-center gap-1.5">
            <MessageCircle color="#f8fafc" size={14} />
            <Text className="text-xs font-semibold uppercase tracking-control text-foreground">Chat</Text>
          </View>
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
  const insets = useSafeAreaInsets();
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
  const [audioOutput, setAudioOutputState] = useState<AudioOutputDevice>("speaker");
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
  const [channelOrder, setChannelOrder] = useState<string[]>([]);
  const [arrangeChannelsOpen, setArrangeChannelsOpen] = useState(false);
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
  const [activeTab, setActiveTab] = useState<"channels" | "settings">("channels");
  const [chatMessages, setChatMessages] = useState<Record<string, ChatMessagePayload[]>>({});
  const [chatOpen, setChatOpen] = useState<string | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [chatInput, setChatInput] = useState("");
  const chatListRef = useRef<FlatList<ChatMessagePayload>>(null);
  const androidNotificationIdRef = useRef<string | undefined>(undefined);
  const notifPermissionGrantedRef = useRef(false);
  const mediaControllerRef = useRef<ReturnType<typeof createMobileMediaController> | null>(null);
  const realtimeClientRef = useRef<CueCommXRealtimeClient | null>(null);
  const pinInputRef = useRef<TextInput>(null);
  const qrScannedRef = useRef(false);
  // Refs for Live Activity Darwin notification callback (always reflects latest values).
  const audioReadyRef = useRef(false);
  audioReadyRef.current = audioReady;
  const talkChannelIdsRef = useRef<string[]>([]);
  talkChannelIdsRef.current = state.operatorState?.talkChannelIds ?? [];

  const [qrScanOpen, setQrScanOpen] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const { servers: discoveredServers, scanning: discoveryScanning } = useServerDiscovery();

  const connectionBadge = getConnectionBadge(state.realtimeState);
  const assignedPermissions = state.session?.user.channelPermissions ?? [];
  const activeChannels = state.session?.channels ?? [];
  // Kept as a ref so the Darwin notification callback always reads the latest value.
  const assignedPermissionsRef = useRef<typeof assignedPermissions>(assignedPermissions);
  assignedPermissionsRef.current = assignedPermissions;
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

    let filtered: ChannelInfo[];
    if (groups.length === 0 || !activeGroupId) {
      filtered = nonConfidence;
    } else {
      const activeGroup = groups.find((g) => g.id === activeGroupId);
      if (!activeGroup) {
        filtered = nonConfidence;
      } else {
        const groupChannelSet = new Set(activeGroup.channelIds);
        const globals = nonConfidence.filter((ch) => ch.isGlobal);
        const groupChannels = nonConfidence.filter(
          (ch) => !ch.isGlobal && groupChannelSet.has(ch.id),
        );
        filtered = [...globals, ...groupChannels];
      }
    }

    if (!channelOrder.length) return filtered;
    const orderSet = new Set(channelOrder);
    const ordered = channelOrder
      .map((id) => filtered.find((ch) => ch.id === id))
      .filter((ch): ch is ChannelInfo => Boolean(ch));
    const remainder = filtered.filter((ch) => !orderSet.has(ch.id));
    return [...ordered, ...remainder];
  }, [state.session?.channels, groups, activeGroupId, channelOrder]);

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
      // Use setTimeout instead of InteractionManager.runAfterInteractions: in
      // React Native's New Architecture (0.79+) interaction tracking can leave
      // a stale handle open during a press sequence, causing runAfterInteractions
      // callbacks to queue indefinitely and block subsequent UI events.
      (task) => {
        setTimeout(task, 0);
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

  // Request local notification permission once on mount
  useEffect(() => {
    void Notifications.requestPermissionsAsync().then(({ granted }) => {
      notifPermissionGrantedRef.current = granted;
    });
  }, []);

  // Handle notification taps — route user to the relevant chat channel
  useEffect(() => {
    // App was already open: listen for taps on incoming banners
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const channelId = response.notification.request.content.data?.channelId;
      if (typeof channelId === "string") {
        setChatOpen(channelId);
      }
    });

    // App was closed/backgrounded: check if the launch came from a notification tap
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const channelId = response.notification.request.content.data?.channelId;
      if (typeof channelId === "string") {
        setChatOpen(channelId);
      }
    });

    return () => sub.remove();
  }, []);

  useEffect(() => {
    let active = true;

    void Promise.all([loadPersistedServerUrl(), loadPersistedUsername()])
      .then(([persistedServerUrl, persistedUsername]) => {
        if (!active) return;

        if (persistedServerUrl) {
          setServerUrlInput((current) => current || persistedServerUrl);
        }

        if (persistedUsername) {
          setUsername((current) => current || persistedUsername);
        }
      })
      .catch((error: unknown) => {
        if (!active) return;

        setRuntimeNotice(getRuntimeMessage(error, "CueCommX could not restore the last session."));
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

  // iOS Live Activity: start when audio becomes ready, register the Darwin toggle listener.
  useEffect(() => {
    if (Platform.OS !== "ios" || !audioReady || !state.session) {
      return;
    }

    startLiveActivity(
      state.session.user.username,
      state.status?.name ?? "CueCommX"
    );

    const toggleSub = addToggleTalkListener(() => {
      const client = realtimeClientRef.current;
      if (!client || !audioReadyRef.current) return;

      const talkIds = talkChannelIdsRef.current;
      const talkableIds = assignedPermissionsRef.current
        .filter((p) => p.canTalk)
        .map((p) => p.channelId);

      if (talkIds.length > 0) {
        client.stopTalk(talkableIds);
      } else if (talkableIds.length > 0) {
        client.startTalk(talkableIds);
      }
    });

    return () => {
      toggleSub?.remove();
      endLiveActivity();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioReady, state.session?.user.username]);

  // iOS Live Activity: keep the widget state in sync with talk state and active channels.
  useEffect(() => {
    if (Platform.OS !== "ios" || !audioReady || !state.session) return;

    const talkChannelNames = activeChannels
      .filter((ch) => state.operatorState?.talkChannelIds?.includes(ch.id))
      .map((ch) => ch.name);
    const listenChannelNames = activeChannels
      .filter((ch) => state.operatorState?.listenChannelIds?.includes(ch.id))
      .map((ch) => ch.name);
    updateLiveActivity({
      isTalking: (state.operatorState?.talkChannelIds?.length ?? 0) > 0,
      isArmed: true,
      talkChannelNames,
      listenChannelNames,
      activeTalkers: remoteTalkers.map((t) => t.producerUsername),
      connectedUserCount: onlineUsers.length,
    });
  }, [
    audioReady,
    state.session,
    state.operatorState?.talkChannelIds,
    state.operatorState?.listenChannelIds,
    activeChannels,
    remoteTalkers,
    onlineUsers,
  ]);

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
          if (msg.userId !== state.session?.user.id) {
            setChatOpen((openChannel) => {
              if (openChannel !== msg.channelId) {
                setUnreadCounts((prev) => ({
                  ...prev,
                  [msg.channelId]: (prev[msg.channelId] ?? 0) + 1,
                }));
                Vibration.vibrate(50);
                if (notifPermissionGrantedRef.current) {
                  const channelName =
                    state.session?.channels?.find((c) => c.id === msg.channelId)?.name ??
                    "Chat";
                  void Notifications.scheduleNotificationAsync({
                    content: {
                      title: `${channelName}: ${msg.username}`,
                      body: msg.text.length > 100 ? msg.text.slice(0, 100) + "…" : msg.text,
                      sound: true,
                      data: { channelId: msg.channelId },
                    },
                    trigger: null,
                  });
                }
              }
              return openChannel;
            });
          }
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
  }, [assignedPermissions, confidenceChannels, state.operatorState?.listenChannelIds, state.realtimeState, state.session]);

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
      void persistUsername(username).catch(() => undefined);

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
        if (Array.isArray(sp.channelOrder)) setChannelOrder(sp.channelOrder as string[]);
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
    setChannelOrder([]);
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
        channelOrder,
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

  async function handleDisarmAudio(): Promise<void> {
    if (!mediaControllerRef.current) return;
    setAudioBusy(true);
    try {
      await mediaControllerRef.current.close();
    } finally {
      setAudioReady(false);
      setAudioArmed(false);
      setAudioBusy(false);
    }
  }

  async function handleSetAudioOutput(output: AudioOutputDevice): Promise<void> {
    setAudioOutputState(output);
    if (audioReady) {
      try {
        await setMobileAudioOutput(output);
      } catch {
        // non-fatal — UI still reflects intent
      }
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

  // Apply audio output device whenever the user changes it or audio becomes ready.
  // On iOS: WebRTC has already initialized the AVAudioSession; overriding the output
  // port after getUserMedia is safe. On Android: updates AudioManager directly.
  // The OS automatically routes the microphone to match the chosen output.
  useEffect(() => {
    if (!audioReady) return;
    void setMobileAudioOutput(audioOutput).catch(() => {/* non-fatal */});
  }, [audioReady, audioOutput]);

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
    <GestureHandlerRootView style={{ flex: 1 }}>
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
                      <Mic color="#5eead4" size={32} />
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
                            <Radio color="#5eead4" size={20} />
                          </View>
                          <View className="flex-1 gap-0.5">
                            <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                              {server.name}
                            </Text>
                            <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                              {server.url}
                            </Text>
                          </View>
                          <ChevronRight color="#94a3b8" size={16} />
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
                        <Camera color="#94a3b8" size={20} />
                      </Pressable>
                    </View>
                  </View>

                  {state.serverError ? (
                    <View className="rounded-xl border border-red-700 bg-red-950 p-4">
                      <Text className="text-sm font-medium leading-6 text-red-300">{state.serverError}</Text>
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
                  <View className="flex-row items-center gap-2 rounded-full border border-success/30 bg-success/10 px-4 py-2">
                    <Circle color="#10b981" fill="#10b981" size={8} />
                    <Text className="text-xs font-semibold text-success">
                      {state.status?.name ?? "Server connected"}
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
                      onSubmitEditing={() => pinInputRef.current?.focus()}
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
                      ref={pinInputRef}
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
                  <View className="rounded-xl border border-red-700 bg-red-950 p-4">
                    <Text className="text-sm font-medium leading-6 text-red-300">{state.loginError}</Text>
                  </View>
                ) : null}

                <Pressable className="items-center py-2" onPress={handleDisconnect}>
                  <View className="flex-row items-center gap-1.5">
                    <ArrowLeft color="#94a3b8" size={14} />
                    <Text className="text-sm font-medium text-muted-foreground">Change server</Text>
                  </View>
                </Pressable>
              </View>
            </ScrollView>
          ) : (
            <View className="flex-1">
              {/* ── Compact header ── */}
              <View className="border-b border-border bg-card/90 px-4 py-3">
                <View className="flex-row items-center gap-3">
                  <View className="flex-1 gap-0.5">
                    <View className="flex-row items-center gap-2">
                      <Text className="text-base font-semibold text-foreground">
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
                    <View className="flex-row items-center gap-1.5">
                      <Text className="text-xs text-muted-foreground">
                        {state.status?.name ?? "CueCommX"}
                      </Text>
                      {connectionQuality ? (
                        <>
                          <Circle
                            color={
                              connectionQuality.grade === "good" || connectionQuality.grade === "excellent"
                                ? "#4ade80"
                                : connectionQuality.grade === "fair"
                                  ? "#fbbf24"
                                  : "#f87171"
                            }
                            fill={
                              connectionQuality.grade === "good" || connectionQuality.grade === "excellent"
                                ? "#4ade80"
                                : connectionQuality.grade === "fair"
                                  ? "#fbbf24"
                                  : "#f87171"
                            }
                            size={7}
                          />
                          <Text className="text-xs text-muted-foreground">
                            {Math.round(connectionQuality.roundTripTimeMs)}ms
                          </Text>
                        </>
                      ) : null}
                    </View>
                  </View>

                  {/* Inline arm / mic level */}
                  {audioReady ? (
                    <View className="items-end gap-1">
                      <View className="flex-row items-center gap-1">
                        <Mic color="#5eead4" size={10} />
                        <Text className="text-[10px] font-semibold text-primary">
                          {inputLevel}%
                        </Text>
                      </View>
                      <View className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary/80">
                        <View
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.max(2, inputLevel)}%` }}
                        />
                      </View>
                    </View>
                  ) : (
                    <Pressable
                      accessibilityLabel="Arm audio"
                      accessibilityRole="button"
                      className={`rounded-lg px-3 py-1.5 ${
                        audioBusy ||
                        !canArmMobileAudio({ hasSession: !!state.session, realtimeState: state.realtimeState })
                          ? "bg-secondary/50 opacity-50"
                          : "bg-primary"
                      }`}
                      disabled={audioBusy || !canArmMobileAudio({ hasSession: !!state.session, realtimeState: state.realtimeState })}
                      onPress={() => void handleArmAudio()}
                    >
                      <Text className="text-xs font-semibold text-primary-foreground">
                        {audioBusy ? "Arming…" : "Arm Audio"}
                      </Text>
                    </Pressable>
                  )}

                  <View className={`rounded-full px-3 py-1 ${connectionBadge.toneClassName}`}>
                    <Text className="text-[10px] font-semibold uppercase tracking-control">
                      {connectionBadge.label}
                    </Text>
                  </View>
                </View>
              </View>

              {/* ── Tally bar ── */}
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
                            <Circle color="#fff" fill="#fff" size={6} />
                            <Text className="text-[10px] font-bold text-destructive-foreground">
                              PGM: {s.sourceName}
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
                            <Circle color="#fff" fill="#fff" size={6} />
                            <Text className="text-[10px] font-bold text-success-foreground">
                              PVW: {s.sourceName}
                            </Text>
                          </View>
                        ))}
                    </View>
                  </ScrollView>
                </View>
              ) : null}

              {/* ── Tab content ── */}
              {activeTab === "channels" ? (
                /* ── CHANNELS TAB ── */
                <ScrollView className="flex-1" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  <View className="gap-3 px-4 pb-6 pt-4">

                    {/* Error banners */}
                    {state.realtimeError ? (
                      <View className="rounded-xl border border-amber-700 bg-amber-950 p-4">
                        <Text className="text-sm font-medium leading-6 text-amber-300">{state.realtimeError}</Text>
                      </View>
                    ) : null}
                    {audioError ? (
                      <View className="rounded-xl border border-amber-700 bg-amber-950 p-4">
                        <Text className="text-sm font-medium leading-6 text-amber-300">{audioError}</Text>
                      </View>
                    ) : null}
                    {runtimeNotice ? (
                      <View className="rounded-xl border border-amber-700 bg-amber-950 p-4">
                        <Text className="text-sm font-medium leading-6 text-amber-300">{runtimeNotice}</Text>
                      </View>
                    ) : null}

                    {/* All-Page active banner */}
                    {allPageActive ? (
                      <View className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3">
                        <View className="flex-row items-center gap-2">
                          <Megaphone color="#fbbf24" size={16} />
                          <Text className="text-sm font-medium text-amber-400">All-Page by {allPageActive.username}</Text>
                        </View>
                      </View>
                    ) : null}

                    {/* Incoming call signals */}
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
                      const signalIcon =
                        signal.signalType === "call"
                          ? <Phone color="#f87171" size={14} />
                          : signal.signalType === "go"
                            ? <Check color="#4ade80" size={14} />
                            : <Timer color="#fbbf24" size={14} />;
                      return (
                        <View
                          className={`flex-row items-center gap-3 rounded-xl border px-4 py-3 ${colorClass}`}
                          key={signal.signalId}
                        >
                          {signalIcon}
                          <Text className={`flex-1 text-sm font-medium ${textColor}`}>
                            {signal.signalType.toUpperCase()} from {signal.fromUsername}
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

                    {/* Incoming call banner */}
                    {incomingCall ? (
                      <View className="flex-row items-center gap-3 rounded-xl border border-blue-500/50 bg-blue-500/10 px-4 py-3">
                        <View className="flex-1 flex-row items-center gap-2">
                          <Phone color="#60a5fa" size={14} />
                          <Text className="text-sm font-medium text-blue-400">
                            Incoming call from {incomingCall.fromUsername}
                          </Text>
                        </View>
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

                    {/* Direct call active banner */}
                    {directCall ? (
                      <View
                        className={`flex-row items-center gap-3 rounded-xl border px-4 py-3 ${
                          directCall.state === "active"
                            ? "border-green-500/50 bg-green-500/10"
                            : "border-blue-500/50 bg-blue-500/10"
                        }`}
                      >
                        <View className="flex-1 flex-row items-center gap-2">
                          {directCall.state === "active"
                            ? <Link color="#4ade80" size={14} />
                            : <Phone color="#60a5fa" size={14} />}
                          <Text
                            className={`text-sm font-medium ${
                              directCall.state === "active" ? "text-green-400" : "text-blue-400"
                            }`}
                          >
                            {directCall.state === "active"
                              ? `Direct call with ${directCall.peerUsername}`
                              : `Calling ${directCall.peerUsername}...`}
                          </Text>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          className="rounded-lg border border-destructive/40 bg-destructive/15 px-3 py-1.5"
                          onPress={endCurrentDirectCall}
                        >
                          <Text className="text-xs font-semibold text-destructive">End Call</Text>
                        </Pressable>
                      </View>
                    ) : null}

                    {/* IFB receive status */}
                    {ifbState ? (
                      <View className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3">
                        <View className="flex-row items-center gap-2">
                          <Headphones color="#fbbf24" size={16} />
                          <Text className="flex-1 text-sm font-medium text-amber-400">
                            {ifbState.fromUsername} is speaking to you — program audio ducked
                          </Text>
                        </View>
                      </View>
                    ) : null}

                    {/* Group filter */}
                    {groups.length > 0 ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View className="flex-row gap-2 pb-1">
                          <Pressable
                            className={`rounded-lg px-3 py-1.5 ${!activeGroupId ? "bg-primary" : "bg-secondary/50"}`}
                            onPress={() => setActiveGroupId(undefined)}
                          >
                            <Text className={`text-sm font-medium ${!activeGroupId ? "text-primary-foreground" : "text-foreground"}`}>
                              All
                            </Text>
                          </Pressable>
                          {groups.map((group) => (
                            <Pressable
                              className={`rounded-lg px-3 py-1.5 ${activeGroupId === group.id ? "bg-primary" : "bg-secondary/50"}`}
                              key={group.id}
                              onPress={() => setActiveGroupId(group.id)}
                            >
                              <Text className={`text-sm font-medium ${activeGroupId === group.id ? "text-primary-foreground" : "text-foreground"}`}>
                                {group.name}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      </ScrollView>
                    ) : null}

                    {/* Channel cards — primary intercom controls */}
                    <View
                      className="gap-3"
                      style={isLandscape || isTablet ? { flexDirection: "row", flexWrap: "wrap" } : undefined}
                    >
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
                              isListening={state.operatorState?.listenChannelIds.includes(channel.id) ?? false}
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
                                  if ((current[channel.id] ?? 100) === rounded) return current;
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

                    {/* Confidence feeds */}
                    {confidenceChannels.length > 0 ? (
                      <SectionCard>
                        <View className="flex-row items-center gap-1.5">
                          <Headphones color="#94a3b8" size={12} />
                          <Text className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                            Confidence Feeds
                          </Text>
                        </View>
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

                    {/* Remote talkers indicator */}
                    {remoteTalkers.length > 0 ? (
                      <View className="flex-row flex-wrap gap-2">
                        {remoteTalkers.map((talker) => (
                          <View
                            className="rounded-lg border border-primary/30 bg-primary/10 px-2 py-1"
                            key={talker.consumerId}
                          >
                            <View className="flex-row items-center gap-1">
                              <Mic color="#5eead4" size={10} />
                              <Text className="text-xs font-medium text-primary">
                                {talker.producerUsername}
                              </Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : null}

                    {/* Direct call */}
                    {!directCall && !incomingCall &&
                      onlineUsers.filter((u) => u.id !== state.session?.user.id).length > 0 ? (
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
                                <View className="flex-row items-center gap-2">
                                  <Phone color="#f8fafc" size={14} />
                                  <Text className="text-sm font-medium text-foreground">{user.username}</Text>
                                </View>
                              </Pressable>
                            ))}
                        </View>
                      </SectionCard>
                    ) : null}

                    {/* IFB controls (admin/operator) — channels tab */}
                    {isAdminOrOperator &&
                      onlineUsers.filter((u) => u.id !== state.session?.user.id).length > 0 ? (
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
                                <View className="flex-row items-center gap-2">
                                  <Headphones color="#f8fafc" size={14} />
                                  <Text className="text-sm font-medium text-foreground">IFB → {user.username}</Text>
                                </View>
                              </Pressable>
                            ))}
                          <Pressable
                            accessibilityRole="button"
                            className="rounded-lg border border-red-500 bg-red-500/20 px-3 py-2"
                            onPress={handleStopIFB}
                          >
                            <Text className="text-sm font-semibold text-red-400">Stop IFB</Text>
                          </Pressable>
                        </View>
                      </SectionCard>
                    ) : null}
                  </View>
                </ScrollView>
              ) : (
                /* ── SETTINGS TAB ── */
                <ScrollView className="flex-1" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  <View className="gap-4 px-4 pb-6 pt-4">

                    {/* Audio */}
                    <SectionCard>
                      <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                        Audio
                      </Text>
                      {!audioReady ? (
                        <ActionButton
                          disabled={audioBusy || !canArmMobileAudio({ hasSession: !!state.session, realtimeState: state.realtimeState })}
                          label={audioBusy ? "Arming..." : audioArmed ? "Retry audio" : "Arm audio"}
                          onPress={() => void handleArmAudio()}
                          tone="primary"
                        />
                      ) : (
                        <>
                          <DetailRow label="Audio status" value={audioStatusLabel} />
                          <ActionButton
                            disabled={audioBusy}
                            label={audioBusy ? "Disarming..." : "Disarm audio"}
                            onPress={() => void handleDisarmAudio()}
                            tone="secondary"
                          />
                        </>
                      )}

                      {/* Audio output device selector — earpiece vs speakerphone */}
                      <View className="gap-2">
                        <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                          Audio Output
                        </Text>
                        <View className="flex-row gap-2">
                          {(
                            [
                              { id: "earpiece", icon: <Phone color="#5eead4" size={14} />, iconMuted: <Phone color="#94a3b8" size={14} />, label: "Earpiece", description: "Private, held to ear" },
                              { id: "speaker", icon: <Volume2 color="#5eead4" size={14} />, iconMuted: <Volume2 color="#94a3b8" size={14} />, label: "Speaker", description: "Hands-free" },
                            ] as { id: AudioOutputDevice; icon: ReactNode; iconMuted: ReactNode; label: string; description: string }[]
                          ).map(({ id, icon, iconMuted, label, description }) => (
                            <Pressable
                              accessibilityLabel={label}
                              accessibilityRole="radio"
                              accessibilityState={{ checked: audioOutput === id }}
                              className={`flex-1 rounded-lg border px-3 py-2.5 ${
                                audioOutput === id
                                  ? "border-primary bg-primary/15"
                                  : "border-border bg-card"
                              }`}
                              key={id}
                              onPress={() => void handleSetAudioOutput(id)}
                            >
                              <View className="flex-row items-center gap-1.5">
                                {audioOutput === id ? icon : iconMuted}
                                <Text
                                  className={`text-sm font-semibold ${
                                    audioOutput === id ? "text-primary" : "text-foreground"
                                  }`}
                                >
                                  {label}
                                </Text>
                              </View>
                              <Text className="mt-0.5 text-xs text-muted-foreground">
                                {description}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>

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
                        <DetailRow label="Background alert" value={androidBackgroundAlertActive ? "Active" : "Standby"} />
                      ) : null}
                      {audioError ? (
                        <View className="rounded-xl border border-amber-700 bg-amber-950 p-4">
                          <Text className="text-sm font-medium leading-6 text-amber-300">{audioError}</Text>
                        </View>
                      ) : null}
                      {runtimeNotice ? (
                        <View className="rounded-xl border border-amber-700 bg-amber-950 p-4">
                          <Text className="text-sm font-medium leading-6 text-amber-300">{runtimeNotice}</Text>
                        </View>
                      ) : null}
                      {remoteTalkers.length > 0 ? (
                        <View className="gap-2">
                          <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                            Remote talkers
                          </Text>
                          {remoteTalkers.map((talker) => (
                            <Text className="text-sm leading-6 text-foreground" key={talker.consumerId}>
                              {talker.producerUsername}:{" "}
                              {talker.activeChannelIds
                                .map((channelId) => activeChannels.find((ch) => ch.id === channelId)?.name ?? channelId)
                                .join(", ")}
                            </Text>
                          ))}
                        </View>
                      ) : null}
                    </SectionCard>

                    {/* Preflight */}
                    <SectionCard>
                      <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                        Preflight mic test
                      </Text>
                      <ActionButton
                        disabled={preflightStep === "recording" || !audioReady}
                        label={preflightStep === "recording" ? "Testing mic..." : "Test Mic"}
                        onPress={handleTestMic}
                        tone="secondary"
                      />
                      {preflightStep === "recording" ? (
                        <View className="rounded-xl border border-primary/30 bg-primary/10 p-3">
                          <View className="flex-row items-center gap-2">
                            <Mic color="#5eead4" size={14} />
                            <Text className="text-sm text-primary">Recording — speak into your mic...</Text>
                          </View>
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
                          <View className="flex-row items-center gap-2">
                            <Check color="#10b981" size={14} />
                            <Text className="text-sm text-success">Mic test passed</Text>
                          </View>
                        </View>
                      ) : null}
                      {preflightStep === "done" && preflightPassed === false ? (
                        <View className="rounded-xl border border-red-700 bg-red-950 p-3">
                          <View className="flex-row items-center gap-2">
                            <X color="#fca5a5" size={14} />
                            <Text className="text-sm font-medium text-red-300">Mic test failed — no audio detected</Text>
                          </View>
                        </View>
                      ) : null}
                    </SectionCard>

                    {/* Talk mode */}
                    <SectionCard>
                      <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                        Talk mode
                      </Text>
                      <View className="flex-row items-center justify-between">
                        <View className="flex-1 gap-0.5">
                          <Text className="text-sm text-foreground">
                            {talkMode === "latched" ? "Latched (toggle)" : "Momentary (hold)"}
                          </Text>
                          <Text className="text-xs text-muted-foreground">
                            {talkMode === "latched"
                              ? "Tap Talk to start/stop talking"
                              : "Hold Talk to talk, release to stop"}
                          </Text>
                        </View>
                        <Switch
                          trackColor={{ false: "#334155", true: "#5eead4" }}
                          thumbColor="#ffffff"
                          value={talkMode === "latched"}
                          onValueChange={(on) => {
                            const next: MobileTalkMode = on ? "latched" : "momentary";
                            setTalkMode(next);
                            queueHapticFeedback(() => triggerTalkHaptic("mode"));
                          }}
                        />
                      </View>
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
                            VOX activates talk when mic level exceeds threshold.
                          </Text>
                        </View>
                      ) : null}
                    </SectionCard>

                    {/* Audio processing + ducking */}
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
                            onValueChange={(value) => setAudioProcessing((cur) => ({ ...cur, noiseSuppression: value }))}
                          />
                        </View>
                        <View className="flex-row items-center justify-between">
                          <Text className="text-sm text-foreground">Auto gain control</Text>
                          <Switch
                            trackColor={{ false: "#334155", true: "#5eead4" }}
                            thumbColor="#ffffff"
                            value={audioProcessing.autoGainControl}
                            onValueChange={(value) => setAudioProcessing((cur) => ({ ...cur, autoGainControl: value }))}
                          />
                        </View>
                        <View className="flex-row items-center justify-between">
                          <Text className="text-sm text-foreground">Echo cancellation</Text>
                          <Switch
                            trackColor={{ false: "#334155", true: "#5eead4" }}
                            thumbColor="#ffffff"
                            value={audioProcessing.echoCancellation}
                            onValueChange={(value) => setAudioProcessing((cur) => ({ ...cur, echoCancellation: value }))}
                          />
                        </View>
                        <View className="flex-row items-center justify-between">
                          <Text className="text-sm text-foreground">Auto-ducking</Text>
                          <Switch
                            trackColor={{ false: "#334155", true: "#5eead4" }}
                            thumbColor="#ffffff"
                            value={duckingEnabled}
                            onValueChange={setDuckingEnabled}
                          />
                        </View>
                      </View>
                      <Text className="text-sm leading-6 text-muted-foreground">
                        Processing takes effect the next time audio is armed.
                      </Text>
                    </SectionCard>

                    {/* All-Page (admin/operator) */}
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

                    {/* Android runtime */}
                    {showAndroidRuntimeSupport ? (
                      <SectionCard>
                        <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                          Android runtime
                        </Text>
                        <Text className="text-sm leading-6 text-muted-foreground">
                          Allow CueCommX notifications and exempt the app from battery optimization for reliable background audio.
                        </Text>
                        <ActionButton
                          label="Open battery settings"
                          onPress={() => void handleOpenBatterySettings()}
                          tone="secondary"
                        />
                      </SectionCard>
                    ) : null}

                    {/* Arrange Channels */}
                    {visibleChannels.length > 0 && state.session ? (
                      <SectionCard>
                        <Text className="text-xs font-semibold uppercase tracking-control text-muted-foreground">
                          Arrange Channels
                        </Text>
                        <Text className="text-sm leading-6 text-muted-foreground">
                          Set the order channels appear in your view.
                        </Text>
                        <ActionButton
                          label="Arrange channels"
                          onPress={() => setArrangeChannelsOpen(true)}
                          tone="secondary"
                        />
                        {channelOrder.length > 0 ? (
                          <ActionButton
                            label="Reset to default order"
                            onPress={() => setChannelOrder([])}
                            tone="secondary"
                          />
                        ) : null}
                      </SectionCard>
                    ) : null}

                    {/* User profile */}
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

                    {/* Sign out */}
                    <View>
                      <ActionButton label="Sign out" onPress={handleSignOut} tone="secondary" />
                    </View>
                  </View>
                </ScrollView>
              )}

              {/* ── Bottom tab bar ── */}
              <View className="flex-row border-t border-border bg-card/95">
                <Pressable
                  accessibilityLabel="Channels"
                  accessibilityRole="tab"
                  className="flex-1 items-center gap-0.5 py-2.5"
                  onPress={() => setActiveTab("channels")}
                >
                  <Mic color={activeTab === "channels" ? "#5eead4" : "#94a3b8"} size={22} />
                  <Text
                    className={`text-[10px] font-semibold uppercase tracking-control ${
                      activeTab === "channels" ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    Channels
                  </Text>
                  {activeTab === "channels" ? (
                    <View className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-primary" />
                  ) : null}
                </Pressable>
                <Pressable
                  accessibilityLabel="Settings"
                  accessibilityRole="tab"
                  className="flex-1 items-center gap-0.5 py-2.5"
                  onPress={() => setActiveTab("settings")}
                >
                  <Settings color={activeTab === "settings" ? "#5eead4" : "#94a3b8"} size={22} />
                  <Text
                    className={`text-[10px] font-semibold uppercase tracking-control ${
                      activeTab === "settings" ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    Settings
                  </Text>
                  {activeTab === "settings" ? (
                    <View className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-primary" />
                  ) : null}
                  {/* Dot when audio not armed */}
                  {!audioReady ? (
                    <View className="absolute right-6 top-2 h-2 w-2 rounded-full bg-destructive" />
                  ) : null}
                </Pressable>
              </View>
            </View>
          )}
        </KeyboardAvoidingView>

        {/* Arrange Channels Modal */}
        <Modal
          animationType="slide"
          onRequestClose={() => setArrangeChannelsOpen(false)}
          transparent={false}
          visible={arrangeChannelsOpen}
        >
          <View style={{ flex: 1, backgroundColor: "#09090b" }}>
            <View
              className="border-b border-border bg-background"
              style={{ paddingTop: insets.top }}
            >
              <View className="flex-row items-center justify-between px-4 py-3">
                <Text className="text-base font-semibold text-foreground">Arrange Channels</Text>
                <Pressable
                  accessibilityLabel="Close"
                  hitSlop={12}
                  onPress={() => setArrangeChannelsOpen(false)}
                >
                  <X color="#94a3b8" size={20} />
                </Pressable>
              </View>
            </View>
            <Text className="px-4 pt-3 pb-1 text-sm text-muted-foreground">
              Hold and drag to reorder channels.
            </Text>
            <DraggableFlatList
              data={channelOrder.length
                ? channelOrder
                    .map((id) => visibleChannels.find((ch) => ch.id === id))
                    .filter((ch): ch is ChannelInfo => Boolean(ch))
                    .concat(visibleChannels.filter((ch) => !new Set(channelOrder).has(ch.id)))
                : visibleChannels}
              keyExtractor={(item) => item.id}
              onDragEnd={({ data }) => setChannelOrder(data.map((ch) => ch.id))}
              renderItem={({ item, drag, isActive }: RenderItemParams<ChannelInfo>) => (
                <ScaleDecorator>
                  <Pressable
                    onLongPress={drag}
                    className={`flex-row items-center gap-3 mx-4 my-1 rounded-lg border px-3 py-3 ${isActive ? "border-primary bg-primary/10" : "border-border bg-card"}`}
                  >
                    <GripVertical color="#94a3b8" size={18} />
                    <View
                      className="h-3 w-3 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <Text className="flex-1 text-sm text-foreground">{item.name}</Text>
                  </Pressable>
                </ScaleDecorator>
              )}
              contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            />
          </View>
        </Modal>

        <Modal
          animationType="slide"
          onRequestClose={() => setChatOpen(null)}
          transparent={false}
          visible={chatOpen !== null}
        >
          {/* KeyboardAvoidingView sits outside the safe-area padding so the
              keyboard offset calculation is based on the full screen height. */}
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={{ flex: 1, backgroundColor: "#09090b" }}
          >
            {/* Header — padded by the top safe area so it clears the Dynamic
                Island on iPhone or the status bar on Android. */}
            <View
              className="border-b border-border bg-background"
              style={{ paddingTop: insets.top }}
            >
              <View className="flex-row items-center px-2 py-1">
                {/* ← Back — large touch target, standard mobile nav pattern */}
                <Pressable
                  accessibilityLabel="Close chat"
                  accessibilityRole="button"
                  className="flex-row items-center gap-1 rounded-lg px-3 py-3"
                  hitSlop={8}
                  onPress={() => setChatOpen(null)}
                >
                  <ChevronLeft color="#5eead4" size={24} />
                  <Text className="text-sm font-semibold text-primary">Back</Text>
                </Pressable>

                {/* Channel name centered in remaining space */}
                <View className="flex-1 flex-row items-center justify-center gap-1.5 pr-14">
                  <MessageCircle color="#94a3b8" size={18} />
                  <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
                    {activeChannels.find((c) => c.id === chatOpen)?.name ?? chatOpen ?? "Chat"}
                  </Text>
                </View>
              </View>
            </View>

            {/* Message list fills the remaining space */}
            <FlatList<ChatMessagePayload>
              ref={chatListRef}
              className="flex-1 bg-background px-4"
              contentContainerStyle={{ paddingVertical: 12, flexGrow: 1 }}
              data={chatOpen ? (chatMessages[chatOpen] ?? []) : []}
              keyExtractor={(item) => item.id}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <View className="flex-1 items-center justify-center pt-16">
                  <Text className="text-sm text-muted-foreground">
                    No messages yet. Start the conversation!
                  </Text>
                </View>
              }
              onContentSizeChange={() => chatListRef.current?.scrollToEnd({ animated: true })}
              renderItem={({ item }) => {
                const isOwn = item.userId === state.session?.user.id;
                return (
                  <View className={`mb-3 ${item.messageType === "system" ? "items-center" : isOwn ? "items-end" : "items-start"}`}>
                    {item.messageType === "system" ? (
                      <Text className="text-xs italic text-muted-foreground">{item.text}</Text>
                    ) : (
                      <View style={{ maxWidth: "80%" }}>
                        {!isOwn && (
                          <View className="mb-0.5 flex-row items-baseline gap-1.5">
                            <Text className="text-xs font-semibold text-foreground">{item.username}</Text>
                            <Text className="text-[10px] text-muted-foreground">{formatRelativeTime(item.timestamp)}</Text>
                          </View>
                        )}
                        <View className={`rounded-2xl px-3 py-2 ${isOwn ? "rounded-tr-sm bg-primary" : "rounded-tl-sm bg-secondary"}`}>
                          <Text className={`text-sm ${isOwn ? "text-primary-foreground" : "text-foreground"}`}>{item.text}</Text>
                        </View>
                        {isOwn && (
                          <Text className="mt-0.5 text-right text-[10px] text-muted-foreground">{formatRelativeTime(item.timestamp)}</Text>
                        )}
                      </View>
                    )}
                  </View>
                );
              }}
            />

            {/* Input bar — padded by the bottom safe area so it clears the
                iPhone home indicator. On Android the bottom inset is 0. */}
            <View
              className="border-t border-border bg-background"
              style={{ paddingBottom: insets.bottom }}
            >
              <View className="flex-row items-center gap-2 px-4 py-3">
                <TextInput
                  className="flex-1 rounded-full border border-border bg-secondary px-4 py-2.5 text-sm text-foreground"
                  maxLength={500}
                  onChangeText={setChatInput}
                  onSubmitEditing={() => chatOpen && sendChatMessage(chatOpen)}
                  placeholder="Type a message…"
                  placeholderTextColor="#6b7280"
                  returnKeyType="send"
                  value={chatInput}
                />
                <Pressable
                  accessibilityRole="button"
                  className={`rounded-full bg-primary px-5 py-2.5 ${!chatInput.trim() ? "opacity-50" : ""}`}
                  disabled={!chatInput.trim()}
                  onPress={() => chatOpen && sendChatMessage(chatOpen)}
                >
                  <Text className="text-sm font-semibold text-primary-foreground">Send</Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}
