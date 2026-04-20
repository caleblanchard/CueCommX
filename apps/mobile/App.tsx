import { StatusBar } from "expo-status-bar";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Slider from "@react-native-community/slider";
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  InteractionManager,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { CueCommXRealtimeClient, type RealtimeConnectionState } from "@cuecommx/core";
import type {
  AuthSuccessResponse,
  ChannelPermission,
  ConnectionQuality,
  DiscoveryResponse,
  OperatorState,
  ServerSignalingMessage,
  StatusResponse,
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
  connected,
  canListen,
  canTalk,
  color,
  isGlobal,
  isListening,
  isTalking,
  name,
  onToggleListen,
  onTalkPress,
  onVolumeChange,
  talkReady,
  talkMode,
  volumePercent,
}: {
  connected: boolean;
  canListen: boolean;
  canTalk: boolean;
  color: string;
  isGlobal: boolean;
  isListening: boolean;
  isTalking: boolean;
  name: string;
  onToggleListen: () => void;
  onTalkPress: (phase: "press-in" | "press-out" | "tap") => void;
  onVolumeChange: (value: number) => void;
  talkReady: boolean;
  talkMode: MobileTalkMode;
  volumePercent: number;
}) {
  const listenEnabled = connected && canListen;
  const talkEnabled = connected && canTalk && talkReady;

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
          <View className="rounded-full border border-border bg-secondary/70 px-3 py-1">
            <Text className="text-[11px] font-semibold uppercase tracking-control text-muted-foreground">
              {talkMode === "momentary" ? "Momentary PTT" : "Latched Talk"}
            </Text>
          </View>
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
              {isTalking
                ? "Talking"
                : !talkReady && canTalk
                  ? "Arm audio"
                  : talkMode === "momentary"
                    ? "Hold to talk"
                    : "Toggle talk"}
            </Text>
          </Pressable>
        </View>

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
  const androidNotificationIdRef = useRef<string | undefined>(undefined);
  const mediaControllerRef = useRef<ReturnType<typeof createMobileMediaController> | null>(null);
  const realtimeClientRef = useRef<CueCommXRealtimeClient | null>(null);

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
        activeChannels.map((channel) => [channel.id, toFraction(channelVolumes[channel.id] ?? 100)]),
      ),
    [activeChannels, channelVolumes],
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

        setState((current) => ({
          ...current,
          realtimeState,
        }));
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
      channelVolumes: mixChannelVolumes,
      masterVolume: toFraction(masterVolume),
    });
  }, [listenChannelIds, masterVolume, mixChannelVolumes]);

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
            <ScrollView
              className="flex-1"
              contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View className="gap-8 px-6 py-10">
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

                  <ActionButton
                    disabled={state.serverLoading || !serverUrlInput.trim()}
                    label={state.serverLoading ? "Connecting..." : "Connect"}
                    onPress={() => void handleCheckServer()}
                  />
                </View>

                {state.serverError ? (
                  <View className="rounded-xl border border-destructive/30 bg-destructive/10 p-4">
                    <Text className="text-sm leading-6 text-destructive">{state.serverError}</Text>
                  </View>
                ) : null}

                <Text className="text-center text-xs leading-5 text-muted-foreground">
                  Enter the IP address or hostname of your CueCommX server.{"\n"}
                  LAN-only — no cloud relay required.
                </Text>
              </View>
            </ScrollView>
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

                  <View className="gap-3">
                    {activeChannels.map((channel) => {
                      const permission = findPermission(assignedPermissions, channel.id);

                      return (
                        <ChannelPermissionCard
                          connected={state.realtimeState === "connected"}
                          canListen={permission?.canListen ?? false}
                          canTalk={permission?.canTalk ?? false}
                          color={channel.color}
                          isGlobal={channel.isGlobal ?? false}
                          isListening={
                            state.operatorState?.listenChannelIds.includes(channel.id) ?? false
                          }
                          isTalking={state.operatorState?.talkChannelIds.includes(channel.id) ?? false}
                          key={channel.id}
                          name={channel.name}
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
                          talkReady={audioReady}
                          talkMode={talkMode}
                          volumePercent={channelVolumes[channel.id] ?? 100}
                        />
                      );
                    })}
                  </View>

                  <View className="pt-4">
                    <ActionButton label="Sign out" onPress={handleSignOut} tone="secondary" />
                  </View>
                </View>
              </ScrollView>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
