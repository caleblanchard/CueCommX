import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import * as Separator from "@radix-ui/react-separator";
import { CueCommXRealtimeClient, type RealtimeConnectionState } from "@cuecommx/core";
import {
  DiscoveryResponseSchema,
  LoginResponseSchema,
  StatusResponseSchema,
  type AuthSuccessResponse,
  type ChannelInfo,
  type ChannelPermission,
  type ChatMessagePayload,
  type ConnectionQuality,
  type DiscoveryResponse,
  type GroupInfo,
  type OperatorState,
  type ServerSignalingMessage,
  type StatusResponse,
  type TallySourceState,
} from "@cuecommx/protocol";
import {
  type CallSignalType,
} from "@cuecommx/protocol";
import {
  Activity,
  Headphones,
  Keyboard,
  Megaphone,
  MessageCircle,
  Mic,
  Phone,
  PhoneOff,
  RadioTower,
  Send,
  Volume2,
  Wifi,
  X,
} from "lucide-react";

import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card.js";
import { SignalMeter } from "./components/ui/signal-meter.js";
import {
  type BandwidthTierInfo,
  createWebMediaController,
  type MediaDeviceOption,
  type RemoteTalkerSnapshot,
  type WebMediaController,
} from "./media/web-media-controller.js";
import {
  PreflightAudioTest,
  type PreflightState,
} from "./media/preflight-audio-test.js";
import {
  type NotificationSoundSettings,
  DEFAULT_NOTIFICATION_SOUND_SETTINGS,
  playNotificationSound,
  playSignalTone,
  setNotificationSoundSettings,
} from "./media/signal-tone.js";
import { VoxDetector } from "./media/vox-detector.js";
import { formatLatencyIndicator, readNetworkRtt } from "./network-latency.js";
import {
  type AudioProcessingPreferences,
  clearStoredSession,
  DEFAULT_AUDIO_PROCESSING,
  DEFAULT_DUCKING_SETTINGS,
  DEFAULT_SIDETONE_SETTINGS,
  type DuckingSettings,
  hasStoredPreferredListenChannelIds,
  loadStoredSession,
  loadWebClientPreferences,
  saveStoredSession,
  saveWebClientPreferences,
  type SidetoneSettings,
  type StorageLike,
  type VoxSettings,
  WEB_CLIENT_PREFERENCES_KEY,
} from "./preferences.js";

interface ViewState {
  discovery?: DiscoveryResponse;
  error?: string;
  loading: boolean;
  loginError?: string;
  loginPending: boolean;
  operatorState?: OperatorState;
  realtimeError?: string;
  realtimeState: RealtimeConnectionState;
  session?: AuthSuccessResponse;
  status?: StatusResponse;
}

const initialState: ViewState = {
  loading: true,
  loginPending: false,
  realtimeState: "idle",
};

const inputClassName =
  "h-12 w-full rounded-xl border border-border bg-background/70 px-4 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30";

const sliderClassName =
  "h-2 w-full cursor-pointer appearance-none rounded-full bg-secondary/70 accent-[hsl(var(--primary))]";

function getConnectionBadge(
  realtimeState: RealtimeConnectionState,
): { label: string; variant: "accent" | "neutral" | "success" | "warning" } {
  switch (realtimeState) {
    case "connected":
      return {
        label: "Live linked",
        variant: "success",
      };
    case "reconnecting":
      return {
        label: "Reconnecting",
        variant: "warning",
      };
    case "connecting":
      return {
        label: "Linking live controls",
        variant: "accent",
      };
    case "closed":
      return {
        label: "Disconnected",
        variant: "warning",
      };
    default:
      return {
        label: "Waiting on operator",
        variant: "neutral",
      };
  }
}

function findPermission(
  permissions: ChannelPermission[],
  channelId: string,
): ChannelPermission | undefined {
  return permissions.find((entry) => entry.channelId === channelId);
}

const QUALITY_GRADE_CONFIG: Record<
  string,
  { label: string; color: string; dotClass: string }
> = {
  excellent: { label: "Excellent", color: "text-green-400", dotClass: "bg-green-400" },
  good: { label: "Good", color: "text-green-400", dotClass: "bg-green-400" },
  fair: { label: "Fair", color: "text-yellow-400", dotClass: "bg-yellow-400" },
  poor: { label: "Poor", color: "text-red-400", dotClass: "bg-red-400" },
};

function formatConnectionQuality(quality: ConnectionQuality | undefined): {
  label: string;
  detail: string;
  dotClass: string;
  color: string;
} {
  if (!quality) {
    return {
      label: "No data",
      detail: "Arm audio to start monitoring",
      dotClass: "bg-muted-foreground",
      color: "text-muted-foreground",
    };
  }

  const config = QUALITY_GRADE_CONFIG[quality.grade] ?? QUALITY_GRADE_CONFIG.poor;

  return {
    label: config.label,
    detail: `${quality.roundTripTimeMs}ms RTT · ${quality.packetLossPercent}% loss · ${quality.jitterMs}ms jitter`,
    dotClass: config.dotClass,
    color: config.color,
  };
}

function normalizeManualServerUrl(input: string): string {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error("Enter a server URL like 10.0.0.25:3000.");
  }

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  const url = new URL(withProtocol);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("CueCommX manual connect requires an http:// or https:// server URL.");
  }

  url.pathname = "/";
  url.search = "";
  url.hash = "";

  return url.toString();
}

function getManualConnectState(input: string): { error?: string; url?: string } {
  if (!input.trim()) {
    return {};
  }

  try {
    return {
      url: normalizeManualServerUrl(input),
    };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Enter a server URL like 10.0.0.25:3000.",
    };
  }
}

function normalizeDeviceId(deviceId: string): string | undefined {
  return deviceId.trim() ? deviceId : undefined;
}

function getBrowserStorage(): StorageLike | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.localStorage;
}

function toFraction(percent: number): number {
  return Math.max(0, Math.min(100, percent)) / 100;
}

export default function App() {
  const persistedPreferencesRaw = useMemo(
    () => getBrowserStorage()?.getItem(WEB_CLIENT_PREFERENCES_KEY) ?? null,
    [],
  );
  const persistedPreferences = useMemo(
    () => loadWebClientPreferences(getBrowserStorage()),
    [],
  );
  const hasPersistedListenPreferences = useMemo(
    () => hasStoredPreferredListenChannelIds(persistedPreferencesRaw),
    [persistedPreferencesRaw],
  );
  const [state, setState] = useState<ViewState>(initialState);
  const [serverUrlInput, setServerUrlInput] = useState("");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [audioArmed, setAudioArmed] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioError, setAudioError] = useState<string>();
  const [forceMuteNotice, setForceMuteNotice] = useState<string>();
  const [audioReady, setAudioReady] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [inputDevices, setInputDevices] = useState<MediaDeviceOption[]>([]);
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState(
    persistedPreferences.selectedInputDeviceId,
  );
  const [masterVolume, setMasterVolume] = useState(persistedPreferences.masterVolume);
  const [audioProcessing, setAudioProcessing] = useState<AudioProcessingPreferences>(
    persistedPreferences.audioProcessing ?? { ...DEFAULT_AUDIO_PROCESSING },
  );
  const [networkRttMs, setNetworkRttMs] = useState<number | undefined>(() =>
    typeof window === "undefined"
      ? undefined
      : readNetworkRtt(
          window.navigator as Navigator & {
            connection?: {
              rtt?: unknown;
            };
          },
        ),
  );
  const [channelVolumes, setChannelVolumes] = useState<Record<string, number>>(
    persistedPreferences.channelVolumes,
  );
  const [latchModeChannelIds, setLatchModeChannelIds] = useState<string[]>(
    persistedPreferences.latchModeChannelIds,
  );
  const [preferredListenChannelIds, setPreferredListenChannelIds] = useState<string[]>(
    persistedPreferences.preferredListenChannelIds,
  );
  const [remoteTalkers, setRemoteTalkers] = useState<RemoteTalkerSnapshot[]>([]);
  const [remoteLevels, setRemoteLevels] = useState<Record<string, number>>({});
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality | undefined>(undefined);
  const [bandwidthTier, setBandwidthTier] = useState<BandwidthTierInfo | undefined>(undefined);
  const [preflightState, setPreflightState] = useState<PreflightState>({
    micLevel: 0,
    passed: undefined,
    step: "idle",
  });
  const preflightRef = useRef<PreflightAudioTest | null>(null);
  const realtimeClientRef = useRef<CueCommXRealtimeClient | null>(null);
  const mediaControllerRef = useRef<WebMediaController | null>(null);
  const mediaStartingRef = useRef(false);
  const restoredListenPreferencesRef = useRef<string | undefined>(undefined);
  const [allPageActive, setAllPageActive] = useState<{ userId: string; username: string } | undefined>();
  const [incomingSignals, setIncomingSignals] = useState<Array<{ signalId: string; signalType: CallSignalType; fromUsername: string; targetChannelId?: string }>>([]);
  const [voxModeChannelIds, setVoxModeChannelIds] = useState<string[]>(persistedPreferences.voxModeChannelIds);
  const [voxSettings, setVoxSettings] = useState<VoxSettings>(persistedPreferences.voxSettings);
  const [channelPans, setChannelPans] = useState<Record<string, number>>(persistedPreferences.channelPans);
  const [sidetone, setSidetone] = useState<SidetoneSettings>(persistedPreferences.sidetone ?? { ...DEFAULT_SIDETONE_SETTINGS });
  const [ducking, setDucking] = useState<DuckingSettings>(persistedPreferences.ducking ?? { ...DEFAULT_DUCKING_SETTINGS });
  const [notificationSettings, setNotificationSettings] = useState<NotificationSoundSettings>(() => {
    const prefs = persistedPreferences.notifications;
    const merged: NotificationSoundSettings = {
      ...DEFAULT_NOTIFICATION_SOUND_SETTINGS,
      ...(prefs ? { enabled: prefs.enabled, volume: prefs.volume } : {}),
      enabledEvents: { ...DEFAULT_NOTIFICATION_SOUND_SETTINGS.enabledEvents, ...(prefs?.enabledEvents ?? {}) },
    };
    setNotificationSoundSettings(merged);
    return merged;
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileNotice, setProfileNotice] = useState<string>();
  const voxDetectorRef = useRef<VoxDetector | null>(null);
  const [signalMenuChannelId, setSignalMenuChannelId] = useState<string | undefined>();
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | undefined>(
    persistedPreferences.activeGroupId,
  );
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
  const [ifbState, setIFBState] = useState<{
    fromUserId: string;
    fromUsername: string;
    duckLevel: number;
  } | null>(null);
  const [chatMessages, setChatMessages] = useState<Record<string, Array<{ id: string; channelId: string; userId: string; username: string; text: string; timestamp: number; messageType: "text" | "system" }>>>({});
  const [chatOpen, setChatOpen] = useState<string | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [recordingActiveIds, setRecordingActiveIds] = useState<string[]>([]);
  const [tallySources, setTallySources] = useState<TallySourceState[]>([]);

  const connectionBadge = getConnectionBadge(state.realtimeState);
  const assignedPermissions = useMemo(
    () => state.session?.user.channelPermissions ?? [],
    [state.session?.user.channelPermissions],
  );

  // Determine the user's assigned group IDs from the groups data
  const userGroupIds = useMemo(() => {
    if (!state.session) {
      return [];
    }

    return (state.session as AuthSuccessResponse & { groups?: GroupInfo[] }).groups
      ?.filter(() => true)
      .map((g) => g.id) ?? [];
  }, [state.session]);

  // Filter visible channels based on active group
  const visibleChannels: ChannelInfo[] = useMemo(() => {
    const allChannels = state.session?.channels ?? [];
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
    (state.session?.channels ?? []).filter((ch) => ch.channelType === "confidence"),
    [state.session?.channels],
  );
  const manualConnect = useMemo(() => getManualConnectState(serverUrlInput), [serverUrlInput]);
  const currentConnectUrl = state.discovery?.primaryUrl ?? window.location.origin;
  const listenChannelIds = state.operatorState?.listenChannelIds ?? [];
  const mixChannelVolumes = useMemo(
    () =>
      Object.fromEntries(
        (state.session?.channels ?? []).map((channel) => {
          const baseVolume = toFraction(channelVolumes[channel.id] ?? 100);
          const duckedVolume = ifbState && channel.channelType === "program"
            ? baseVolume * ifbState.duckLevel
            : baseVolume;
          return [channel.id, duckedVolume];
        }),
      ),
    [channelVolumes, state.session?.channels, ifbState],
  );
  const remoteTalkersByChannel = useMemo(() => {
    const next = new Map<string, string[]>();

    for (const talker of remoteTalkers) {
      for (const channelId of talker.activeChannelIds) {
        const usernames = next.get(channelId) ?? [];

        if (!usernames.includes(talker.producerUsername)) {
          usernames.push(talker.producerUsername);
          usernames.sort((left, right) => left.localeCompare(right));
        }

        next.set(channelId, usernames);
      }
    }

    return next;
  }, [remoteTalkers]);
  const latencyLabel = formatLatencyIndicator(networkRttMs);
  const qualityInfo = formatConnectionQuality(connectionQuality);
  const liveRemoteTalkerUsernames = useMemo(
    () =>
      [...new Set(remoteTalkers.map((talker) => talker.producerUsername))].sort((left, right) =>
        left.localeCompare(right),
      ),
    [remoteTalkers],
  );
  const isSignedIn = Boolean(state.session);
  const audioStatusBadge = audioReady
    ? ({ label: "Audio ready", variant: "success" } as const)
    : audioBusy
      ? ({ label: "Arming audio", variant: "warning" } as const)
      : audioArmed
        ? ({ label: "Restoring audio", variant: "warning" } as const)
        : ({ label: "Audio setup needed", variant: "accent" } as const);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadIntercomShell(): Promise<void> {
      try {
        const [statusResponse, discoveryResponse] = await Promise.all([
          fetch("/api/status", { signal: abortController.signal }),
          fetch("/api/discovery", { signal: abortController.signal }),
        ]);

        if (!statusResponse.ok || !discoveryResponse.ok) {
          throw new Error("Unable to load CueCommX web client data.");
        }

        const status = StatusResponseSchema.parse(await statusResponse.json());
        const discovery = DiscoveryResponseSchema.parse(await discoveryResponse.json());

        const storedSession = loadStoredSession(getBrowserStorage());
        let restoredSession: AuthSuccessResponse | undefined;

        if (storedSession) {
          try {
            const sessionResponse = await fetch("/api/auth/session", {
              headers: { Authorization: `Bearer ${storedSession.sessionToken}` },
              signal: abortController.signal,
            });

            if (sessionResponse.ok) {
              const payload = LoginResponseSchema.parse(await sessionResponse.json());

              if (payload.success) {
                restoredSession = payload;
              }
            }
          } catch {
            // Session restore failed — fall through to login screen
          }

          if (!restoredSession) {
            clearStoredSession(getBrowserStorage());
          }
        }

        if (restoredSession) {
          if (restoredSession.groups) {
            setGroups(restoredSession.groups);
          }

          setState({
            discovery,
            loading: false,
            loginPending: false,
            realtimeState: "connecting",
            session: restoredSession,
            status,
          });
        } else {
          setState({
            discovery,
            loading: false,
            loginPending: false,
            realtimeState: "idle",
            status,
          });

          if (storedSession?.username) {
            setUsername(storedSession.username);
          }
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setState({
          error: error instanceof Error ? error.message : "Unknown web client error.",
          loading: false,
          loginPending: false,
          realtimeState: "idle",
        });
      }
    }

    void loadIntercomShell();

    return () => abortController.abort();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const connection = (window.navigator as Navigator & {
      connection?: {
        addEventListener?: (type: "change", listener: () => void) => void;
        removeEventListener?: (type: "change", listener: () => void) => void;
        rtt?: unknown;
      };
    }).connection;

    const handleConnectionChange = () => {
      setNetworkRttMs(
        readNetworkRtt(
          window.navigator as Navigator & {
            connection?: {
              rtt?: unknown;
            };
          },
        ),
      );
    };

    handleConnectionChange();
    connection?.addEventListener?.("change", handleConnectionChange);

    return () => {
      connection?.removeEventListener?.("change", handleConnectionChange);
    };
  }, []);

  useEffect(() => {
    if (!state.session) {
      return;
    }

    let active = true;
    const realtimeClient = new CueCommXRealtimeClient({
      baseUrl: window.location.origin,
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
            if (message.payload.code === "unauthorized") {
              clearStoredSession(getBrowserStorage());
            }

            return {
              ...current,
              realtimeError: message.payload.message,
            };
          }

          if (message.type === "force-muted") {
            const notice =
              message.payload.reason === "channel"
                ? "An admin unlatched a channel you were talking on."
                : "An admin has force-muted your microphone.";

            setForceMuteNotice(notice);
            setTimeout(() => setForceMuteNotice(undefined), 5000);
          }

          if (message.type === "allpage:active") {
            setAllPageActive(message.payload);
            playNotificationSound("allpage");
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
            playSignalTone(message.payload.signalType);
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
            playNotificationSound("directCall");
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

          return current;
        });
      },
      sessionToken: state.session.sessionToken,
    });
    const mediaController = createWebMediaController({
      onConnectionQualityChange: (quality) => {
        if (!active) {
          return;
        }

        setConnectionQuality(quality);
      },
      onError: (error) => {
        if (!active) {
          return;
        }

        setAudioError(error.message);
      },
      onInputDevicesChange: (devices) => {
        if (!active) {
          return;
        }

        setInputDevices(devices);
        setSelectedInputDeviceId((current) => current || devices[0]?.deviceId || "");
      },
      onLocalLevelChange: (level) => {
        if (!active) {
          return;
        }

        setInputLevel(level);
      },
      onRemoteLevelsChange: (levels) => {
        if (!active) {
          return;
        }

        setRemoteLevels(levels);
      },
      onRemoteTalkersChange: (talkers) => {
        if (!active) {
          return;
        }

        setRemoteTalkers(talkers);
      },
      realtimeClient,
    });

    realtimeClientRef.current = realtimeClient;
    mediaControllerRef.current = mediaController;
    mediaController.setAudioProcessing(audioProcessing);
    realtimeClient.connect();

    return () => {
      active = false;
      realtimeClientRef.current = null;
      mediaControllerRef.current = null;
      realtimeClient.disconnect();
      void mediaController.close();
      setAudioArmed(false);
      setAudioBusy(false);
      setAudioError(undefined);
      setAudioReady(false);
      setInputDevices([]);
      setInputLevel(0);
      setRemoteTalkers([]);
      setRemoteLevels({});
      setConnectionQuality(undefined);
      setOnlineUsers([]);
      setDirectCall(null);
      setIncomingCall(null);
    };
  }, [state.session?.sessionToken]);

  useEffect(() => {
    if (!state.session?.channels.length) {
      return;
    }

    setChannelVolumes((current) => {
      let changed = false;
      const next = { ...current };
      const activeChannelIds = new Set(state.session?.channels.map((channel) => channel.id));

      for (const channel of state.session?.channels ?? []) {
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
  }, [state.session?.channels]);

  useEffect(() => {
    const allowedTalkChannelIds = new Set(
      assignedPermissions.filter((permission) => permission.canTalk).map((permission) => permission.channelId),
    );

    setLatchModeChannelIds((current) => {
      const next = current.filter((channelId) => allowedTalkChannelIds.has(channelId));
      return next.length === current.length ? current : next;
    });
  }, [assignedPermissions]);

  useEffect(() => {
    const allowedTalkChannelIds = new Set(
      assignedPermissions.filter((permission) => permission.canTalk).map((permission) => permission.channelId),
    );

    setVoxModeChannelIds((current) => {
      const next = current.filter((channelId) => allowedTalkChannelIds.has(channelId));
      return next.length === current.length ? current : next;
    });
  }, [assignedPermissions]);

  useEffect(() => {
    const allowedListenChannelIds = new Set(
      assignedPermissions
        .filter((permission) => permission.canListen)
        .map((permission) => permission.channelId),
    );

    setPreferredListenChannelIds((current) => {
      const next = current.filter((channelId) => allowedListenChannelIds.has(channelId));
      return next.length === current.length ? current : next;
    });
  }, [assignedPermissions]);

  useEffect(() => {
    if (!hasPersistedListenPreferences && !state.operatorState) {
      return;
    }

    saveWebClientPreferences(getBrowserStorage(), {
      activeGroupId,
      audioProcessing,
      channelPans,
      channelVolumes,
      ducking,
      latchModeChannelIds,
      masterVolume,
      notifications: {
        enabled: notificationSettings.enabled,
        enabledEvents: notificationSettings.enabledEvents,
        volume: notificationSettings.volume,
      },
      preferredListenChannelIds,
      selectedInputDeviceId,
      sidetone,
      voxModeChannelIds,
      voxSettings,
    });
  }, [
    activeGroupId,
    audioProcessing,
    channelPans,
    channelVolumes,
    ducking,
    hasPersistedListenPreferences,
    latchModeChannelIds,
    masterVolume,
    notificationSettings,
    preferredListenChannelIds,
    selectedInputDeviceId,
    sidetone,
    state.operatorState,
    voxModeChannelIds,
    voxSettings,
  ]);

  useEffect(() => {
    if (hasPersistedListenPreferences || !state.operatorState) {
      return;
    }

    setPreferredListenChannelIds(state.operatorState.listenChannelIds);
  }, [hasPersistedListenPreferences, state.operatorState]);

  useEffect(() => {
    restoredListenPreferencesRef.current = undefined;
  }, [state.session?.sessionToken]);

  useEffect(() => {
    mediaControllerRef.current?.setAudioProcessing(audioProcessing);
  }, [audioProcessing]);

  useEffect(() => {
    const controller = mediaControllerRef.current;
    if (!controller || !audioReady) return;

    if (sidetone.enabled) {
      controller.enableSidetone(sidetone.level / 100);
    } else {
      controller.disableSidetone();
    }
  }, [audioReady, sidetone]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatOpen]);

  useEffect(() => {
    if (!audioReady || voxModeChannelIds.length === 0) {
      voxDetectorRef.current?.stop();
      voxDetectorRef.current = null;
      return;
    }

    const nodes = mediaControllerRef.current?.getVoxAudioNodes();

    if (!nodes) {
      return;
    }

    const detector = new VoxDetector({
      holdTimeMs: voxSettings.holdTimeMs,
      thresholdDb: voxSettings.thresholdDb,
      onVoxStart: () => {
        for (const channelId of voxModeChannelIds) {
          startTalk(channelId);
        }
      },
      onVoxStop: () => {
        for (const channelId of voxModeChannelIds) {
          stopTalk(channelId, true);
        }
      },
    });

    detector.start(nodes.audioContext, nodes.sourceNode);
    voxDetectorRef.current = detector;

    return () => {
      detector.stop();
      voxDetectorRef.current = null;
    };
  }, [audioReady, voxModeChannelIds]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    voxDetectorRef.current?.updateSettings({
      holdTimeMs: voxSettings.holdTimeMs,
      thresholdDb: voxSettings.thresholdDb,
    });
  }, [voxSettings]);

  useEffect(() => {
    if (
      !state.session ||
      !state.operatorState ||
      state.realtimeState !== "connected" ||
      !hasPersistedListenPreferences ||
      restoredListenPreferencesRef.current === state.session.sessionToken
    ) {
      return;
    }

    restoredListenPreferencesRef.current = state.session.sessionToken;

    const allowedListenChannelIds = new Set(
      assignedPermissions
        .filter((permission) => permission.canListen)
        .map((permission) => permission.channelId),
    );
    const desiredListenChannelIds = preferredListenChannelIds.filter((channelId) =>
      allowedListenChannelIds.has(channelId),
    );
    const currentListenChannelIds = new Set(state.operatorState.listenChannelIds);

    for (const channelId of desiredListenChannelIds) {
      if (!currentListenChannelIds.has(channelId)) {
        realtimeClientRef.current?.toggleListen(channelId, true);
      }
    }

    for (const channelId of state.operatorState.listenChannelIds) {
      if (!desiredListenChannelIds.includes(channelId) && allowedListenChannelIds.has(channelId)) {
        realtimeClientRef.current?.toggleListen(channelId, false);
      }
    }
  }, [
    assignedPermissions,
    hasPersistedListenPreferences,
    preferredListenChannelIds,
    state.operatorState,
    state.realtimeState,
    state.session,
  ]);

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

  useEffect(() => {
    mediaControllerRef.current?.updateMix({
      activeListenChannelIds: listenChannelIds,
      activeTalkerChannelIds: remoteTalkers.flatMap((t) => t.activeChannelIds),
      channelPans,
      channelPriorities: Object.fromEntries(
        (state.session?.channels ?? []).map((ch) => [ch.id, ch.priority ?? 5]),
      ),
      channelVolumes: mixChannelVolumes,
      duckingEnabled: ducking.enabled,
      duckLevel: ducking.level / 100,
      masterVolume: toFraction(masterVolume),
    });
  }, [channelPans, ducking, listenChannelIds, masterVolume, mixChannelVolumes, remoteTalkers, state.session?.channels]);

  useEffect(() => {
    if (!audioArmed || !mediaControllerRef.current) {
      return;
    }

    if (state.realtimeState !== "connected") {
      mediaControllerRef.current.resetConnection();
      setAudioReady(false);
      setInputLevel(0);
      setRemoteTalkers([]);
      setRemoteLevels({});
      return;
    }

    if (audioReady || mediaStartingRef.current) {
      return;
    }

    mediaStartingRef.current = true;
    setAudioBusy(true);

    const controller = mediaControllerRef.current;

    void controller
      .start(normalizeDeviceId(selectedInputDeviceId))
      .then(() => {
        setAudioError(undefined);
        setAudioReady(true);
      })
      .catch((error: unknown) => {
        setAudioError(
          error instanceof Error ? error.message : "CueCommX could not restore browser audio.",
        );
        setAudioReady(false);
      })
      .finally(() => {
        mediaStartingRef.current = false;
        setAudioBusy(false);
      });
  }, [audioArmed, audioReady, selectedInputDeviceId, state.realtimeState]);

  // Headset button PTT via Media Session API
  useEffect(() => {
    if (!audioReady || state.realtimeState !== "connected" || !state.operatorState) {
      return;
    }

    if ("mediaSession" in navigator) {
      const talkChannelIds = state.operatorState.talkChannelIds;
      const activeChannelNames = visibleChannels
        .filter((ch) => talkChannelIds.includes(ch.id))
        .map((ch) => ch.name);

      const listenChannelNames = visibleChannels
        .filter((ch) => state.operatorState!.listenChannelIds.includes(ch.id))
        .map((ch) => ch.name);

      const statusLine =
        activeChannelNames.length > 0
          ? `🎙 Talking: ${activeChannelNames.join(", ")}`
          : listenChannelNames.length > 0
            ? `🔉 Listening: ${listenChannelNames.join(", ")}`
            : "Standby";

      navigator.mediaSession.metadata = new MediaMetadata({
        title: "CueCommX Intercom",
        artist: state.session?.user.username ?? "Operator",
        album: statusLine,
      });

      const handleToggle = (): void => {
        const talkableChannels = visibleChannels.filter((ch) => {
          const perm = findPermission(assignedPermissions, ch.id);
          return perm?.canTalk && ch.channelType !== "program" && ch.channelType !== "confidence";
        });
        if (talkableChannels.length === 0) return;

        const channelId = talkableChannels[0].id;
        const isTalking = state.operatorState?.talkChannelIds.includes(channelId);

        if (isTalking) {
          stopTalk(channelId, true);
        } else {
          startTalk(channelId);
        }
      };

      try {
        navigator.mediaSession.setActionHandler("play", handleToggle);
        navigator.mediaSession.setActionHandler("pause", handleToggle);
        navigator.mediaSession.setActionHandler("togglemicrophone" as MediaSessionAction, handleToggle);
      } catch {
        // Some browsers don't support all action handlers
      }

      return () => {
        try {
          navigator.mediaSession.setActionHandler("play", null);
          navigator.mediaSession.setActionHandler("pause", null);
          navigator.mediaSession.setActionHandler("togglemicrophone" as MediaSessionAction, null);
        } catch {
          // Cleanup silently
        }
      };
    }
  });

  async function handleLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    setState((current) => ({
      ...current,
      loginError: undefined,
      loginPending: true,
      operatorState: undefined,
      realtimeError: undefined,
      realtimeState: "connecting",
    }));

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          pin: pin || undefined,
        }),
      });

      const payload = LoginResponseSchema.parse(await response.json());

      if (!response.ok || !payload.success) {
        throw new Error(payload.success ? "Unable to sign in to CueCommX." : payload.error);
      }

      saveStoredSession(getBrowserStorage(), {
        sessionToken: payload.sessionToken,
        username: payload.user.username,
      });

      if (payload.groups) {
        setGroups(payload.groups);
      }

      // Apply server-stored preferences if they exist
      const serverPrefs = payload.preferences;
      if (serverPrefs && typeof serverPrefs === "object" && Object.keys(serverPrefs).length > 0) {
        const sp = serverPrefs as Record<string, unknown>;
        if (typeof sp.masterVolume === "number") setMasterVolume(sp.masterVolume as number);
        if (sp.channelVolumes && typeof sp.channelVolumes === "object") setChannelVolumes(sp.channelVolumes as Record<string, number>);
        if (sp.channelPans && typeof sp.channelPans === "object") setChannelPans(sp.channelPans as Record<string, number>);
        if (Array.isArray(sp.latchModeChannelIds)) setLatchModeChannelIds(sp.latchModeChannelIds as string[]);
        if (Array.isArray(sp.voxModeChannelIds)) setVoxModeChannelIds(sp.voxModeChannelIds as string[]);
        if (sp.sidetone && typeof sp.sidetone === "object") {
          const st = sp.sidetone as Record<string, unknown>;
          setSidetone({
            enabled: typeof st.enabled === "boolean" ? st.enabled : false,
            level: typeof st.level === "number" ? st.level : 15,
          });
        }
        if (sp.ducking && typeof sp.ducking === "object") {
          const dk = sp.ducking as Record<string, unknown>;
          setDucking({
            enabled: typeof dk.enabled === "boolean" ? dk.enabled : true,
            level: typeof dk.level === "number" ? dk.level : 30,
          });
        }
        if (sp.voxSettings && typeof sp.voxSettings === "object") {
          const vs = sp.voxSettings as Record<string, unknown>;
          setVoxSettings({
            holdTimeMs: typeof vs.holdTimeMs === "number" ? vs.holdTimeMs : 500,
            thresholdDb: typeof vs.thresholdDb === "number" ? vs.thresholdDb : -40,
          });
        }
      }

      setState((current) => ({
        ...current,
        loginError: undefined,
        loginPending: false,
        session: payload,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        loginError: error instanceof Error ? error.message : "Unknown sign-in error.",
        loginPending: false,
        realtimeState: "idle",
      }));
    }
  }

  async function handleSaveProfile(): Promise<void> {
    if (!state.session) return;
    setProfileSaving(true);
    setProfileNotice(undefined);
    try {
      const prefs = {
        masterVolume,
        channelVolumes,
        channelPans,
        ducking,
        latchModeChannelIds,
        voxModeChannelIds,
        voxSettings,
        sidetone,
        audioProcessing,
        activeGroupId,
      };
      const res = await fetch("/api/preferences", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${state.session.sessionToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(prefs),
      });
      if (!res.ok) throw new Error("Failed to save profile");
      setProfileNotice("Profile saved to server");
      setTimeout(() => setProfileNotice(undefined), 3000);
    } catch (error) {
      setProfileNotice(error instanceof Error ? error.message : "Save failed");
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleArmAudio(): Promise<void> {
    if (state.realtimeState !== "connected" || !mediaControllerRef.current) {
      setAudioError("CueCommX needs a live signaling link before browser audio can start.");
      return;
    }

    setAudioBusy(true);

    try {
      await mediaControllerRef.current.start(normalizeDeviceId(selectedInputDeviceId));
      setAudioArmed(true);
      setAudioError(undefined);
      setAudioReady(true);
    } catch (error) {
      setAudioError(
        error instanceof Error ? error.message : "CueCommX could not start browser audio.",
      );
      setAudioReady(false);
    } finally {
      setAudioBusy(false);
    }
  }

  async function handleInputDeviceChange(deviceId: string): Promise<void> {
    setSelectedInputDeviceId(deviceId);

    if (!audioArmed || !mediaControllerRef.current) {
      return;
    }

    setAudioBusy(true);

    try {
      await mediaControllerRef.current.switchInputDevice(normalizeDeviceId(deviceId));
      setAudioError(undefined);
    } catch (error) {
      setAudioError(
        error instanceof Error ? error.message : "CueCommX could not switch microphone inputs.",
      );
    } finally {
      setAudioBusy(false);
    }
  }

  async function handleStartPreflight(): Promise<void> {
    preflightRef.current?.cancel();
    const test = new PreflightAudioTest();
    preflightRef.current = test;

    test.onStateChange((next) => {
      setPreflightState(next);

      if (next.step === "done" && realtimeClientRef.current) {
        realtimeClientRef.current.reportPreflightResult(next.passed ? "passed" : "failed");
      }
    });

    await test.run();
  }

  function handleCancelPreflight(): void {
    preflightRef.current?.cancel();
    preflightRef.current = null;
  }

  function updateListen(channelId: string, listening: boolean): void {
    if (!audioReady) {
      setAudioError("Arm browser audio before changing listen routes on the web client.");
      return;
    }

    try {
      setAudioError(undefined);
      setState((current) => ({
        ...current,
        realtimeError: undefined,
      }));
      setPreferredListenChannelIds((current) =>
        listening
          ? [...new Set([...current, channelId])].sort((left, right) => left.localeCompare(right))
          : current.filter((entry) => entry !== channelId),
      );
      realtimeClientRef.current?.toggleListen(channelId, listening);
    } catch (error) {
      setState((current) => ({
        ...current,
        realtimeError: error instanceof Error ? error.message : "Unable to update listen state.",
      }));
    }
  }

  function startTalk(channelId: string): void {
    if (!audioReady) {
      setAudioError("Arm browser audio before starting Talk on the web client.");
      return;
    }

    if (state.operatorState?.talking && state.operatorState.talkChannelIds.includes(channelId)) {
      return;
    }

    try {
      setAudioError(undefined);
      setState((current) => ({
        ...current,
        realtimeError: undefined,
      }));
      realtimeClientRef.current?.startTalk([channelId]);
    } catch (error) {
      setState((current) => ({
        ...current,
        realtimeError: error instanceof Error ? error.message : "Unable to start talking.",
      }));
    }
  }

  function stopTalk(channelId: string, force = false): void {
    const latchModeEnabled = latchModeChannelIds.includes(channelId);

    if (!force && latchModeEnabled) {
      return;
    }

    if (!state.operatorState?.talkChannelIds.includes(channelId)) {
      return;
    }

    try {
      realtimeClientRef.current?.stopTalk([channelId]);
    } catch (error) {
      setState((current) => ({
        ...current,
        realtimeError: error instanceof Error ? error.message : "Unable to stop talking.",
      }));
    }
  }

  function toggleLatchMode(channelId: string): void {
    setLatchModeChannelIds((current) =>
      current.includes(channelId)
        ? current.filter((entry) => entry !== channelId)
        : [...current, channelId],
    );
    setVoxModeChannelIds((current) => current.filter((entry) => entry !== channelId));
  }

  function toggleVoxMode(channelId: string): void {
    setVoxModeChannelIds((current) =>
      current.includes(channelId)
        ? current.filter((entry) => entry !== channelId)
        : [...current, channelId],
    );
    setLatchModeChannelIds((current) => current.filter((entry) => entry !== channelId));
  }

  function sendSignalToChannel(channelId: string, signalType: CallSignalType): void {
    realtimeClientRef.current?.sendCallSignal(signalType, { channelId });
    setSignalMenuChannelId(undefined);
  }

  function sendChatMessage(channelId: string): void {
    const text = chatInput.trim();

    if (!text || !realtimeClientRef.current) {
      return;
    }

    realtimeClientRef.current.sendChatMessage(channelId, text);
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

  function requestDirectCall(targetUserId: string): void {
    if (directCall || incomingCall) {
      return;
    }

    realtimeClientRef.current?.requestDirectCall(targetUserId);
    const targetUser = onlineUsers.find((u) => u.id === targetUserId);

    setDirectCall({
      callId: "",
      peerUserId: targetUserId,
      peerUsername: targetUser?.username ?? "Unknown",
      state: "requesting",
    });
  }

  function acceptIncomingCall(): void {
    if (!incomingCall) {
      return;
    }

    realtimeClientRef.current?.acceptDirectCall(incomingCall.callId);
  }

  function rejectIncomingCall(): void {
    if (!incomingCall) {
      return;
    }

    realtimeClientRef.current?.rejectDirectCall(incomingCall.callId);
    setIncomingCall(null);
  }

  function endCurrentDirectCall(): void {
    if (!directCall) {
      return;
    }

    realtimeClientRef.current?.endDirectCall(directCall.callId);
    setDirectCall(null);
  }

  const callableUsers = onlineUsers.filter(
    (u) => u.id !== state.session?.user.id,
  );

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8 sm:px-8 lg:px-10">
        <header
          className={
            isSignedIn
              ? "space-y-4"
              : "flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between"
          }
        >
          <div className={isSignedIn ? "max-w-4xl space-y-3" : "max-w-3xl space-y-4"}>
            <Badge variant="accent">{isSignedIn ? "Live operator surface" : "Control surface preview"}</Badge>
            <div className="space-y-3">
              <h1
                className={`text-balance font-semibold tracking-tight text-foreground ${
                  isSignedIn ? "text-3xl sm:text-4xl" : "text-4xl sm:text-5xl"
                }`}
              >
                {isSignedIn ? (state.status?.name ?? "CueCommX") : "CueCommX Web Client"}
              </h1>
              <p className={`max-w-3xl leading-7 text-muted-foreground ${isSignedIn ? "text-base" : "text-lg"}`}>
                {isSignedIn
                  ? `Signed in as ${state.session?.user.username}. Your assigned channels stay front and center, while audio setup and session health only appear when they are actionable.`
                  : "A dark-first, keyboard-friendly party-line surface with real browser audio, live listen routing, and stable Talk targets for local productions."}
              </p>
            </div>
            {isSignedIn ? (
              <div className="flex flex-wrap gap-3">
                <Badge variant="success">{state.session?.user.role ?? "operator"}</Badge>
                <Badge variant={connectionBadge.variant}>{connectionBadge.label}</Badge>
                <Badge variant={audioStatusBadge.variant}>{audioStatusBadge.label}</Badge>
                <Badge variant="accent">
                  {state.session?.channels.length ?? 0} assigned channel
                  {(state.session?.channels.length ?? 0) === 1 ? "" : "s"}
                </Badge>
              </div>
            ) : null}
            {isSignedIn && tallySources.some((s) => s.state !== "none") ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm">
                <span className="font-semibold text-muted-foreground">TALLY</span>
                {tallySources
                  .filter((s) => s.state === "program")
                  .map((s) => (
                    <span
                      className="flex items-center gap-1.5 rounded-md bg-destructive px-2 py-0.5 text-xs font-bold text-destructive-foreground"
                      key={s.sourceId}
                    >
                      🔴 PROGRAM: {s.sourceName}
                    </span>
                  ))}
                {tallySources
                  .filter((s) => s.state === "preview")
                  .map((s) => (
                    <span
                      className="flex items-center gap-1.5 rounded-md bg-success px-2 py-0.5 text-xs font-bold text-success-foreground"
                      key={s.sourceId}
                    >
                      🟢 PREVIEW: {s.sourceName}
                    </span>
                  ))}
              </div>
            ) : null}
          </div>

          {!isSignedIn ? (
            <Card className="w-full max-w-xl">
              <CardHeader>
                <CardDescription>Live session shell</CardDescription>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <CardTitle>{state.status?.name ?? "CueCommX"}</CardTitle>
                    <p className="text-sm leading-6 text-muted-foreground">
                      Join the local intercom first. Browser audio and live telemetry stay hidden
                      until they can actually help the operator.
                    </p>
                  </div>
                  <Badge variant={connectionBadge.variant}>{connectionBadge.label}</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-2">
                  <Keyboard className="h-4 w-4 text-primary" />
                  Momentary and latch Talk
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-2">
                  <Wifi className="h-4 w-4 text-primary" />
                  Exponential reconnect
                </div>
                <a
                  className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-2 text-foreground underline-offset-4 hover:text-primary hover:underline"
                  href={currentConnectUrl}
                >
                  <RadioTower className="h-4 w-4 text-primary" />
                  {currentConnectUrl}
                </a>
              </CardContent>
            </Card>
          ) : null}
        </header>

        {state.loading ? (
          <Card>
            <CardContent className="flex items-center gap-3 text-sm text-muted-foreground">
              <RadioTower className="h-4 w-4 text-primary" />
              Loading channels...
            </CardContent>
          </Card>
        ) : null}

        {state.error ? (
          <Card className="border-danger/50">
            <CardContent className="text-sm text-danger">{state.error}</CardContent>
          </Card>
        ) : null}

        {state.status ? (
          !isSignedIn ? (
            <section className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
              <Card>
                <CardHeader>
                  <CardDescription>
                    {state.status.needsAdminSetup ? "System onboarding" : "Operator sign-in"}
                  </CardDescription>
                  <CardTitle>
                    {state.status.needsAdminSetup ? "Waiting for the first admin" : "Join local intercom"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {state.status.needsAdminSetup ? (
                    <p className="text-sm leading-6 text-muted-foreground">
                      The admin dashboard needs to create the first account before operators can
                      join this server.
                    </p>
                  ) : (
                    <form className="space-y-4" onSubmit={(event) => void handleLogin(event)}>
                      <div className="rounded-2xl border border-border/60 bg-background/35 p-4">
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Current server
                        </p>
                        <a
                          className="mt-2 block break-all text-sm font-medium text-primary underline-offset-4 hover:underline"
                          href={currentConnectUrl}
                        >
                          {currentConnectUrl}
                        </a>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          Only the join details matter here. Browser audio setup appears after you
                          sign in, when the operator surface can actually use it.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground" htmlFor="username">
                          Operator name
                        </label>
                        <input
                          autoComplete="username"
                          className={inputClassName}
                          id="username"
                          name="username"
                          onChange={(event) => setUsername(event.target.value)}
                          placeholder="Front of House"
                          value={username}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground" htmlFor="pin">
                          PIN
                        </label>
                        <input
                          autoComplete="current-password"
                          className={inputClassName}
                          id="pin"
                          name="pin"
                          onChange={(event) => setPin(event.target.value)}
                          placeholder="Optional"
                          type="password"
                          value={pin}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground" htmlFor="manual-server-url">
                          Open a different server
                        </label>
                        <input
                          className={inputClassName}
                          id="manual-server-url"
                          onChange={(event) => setServerUrlInput(event.target.value)}
                          placeholder="10.0.0.25:3000"
                          value={serverUrlInput}
                        />
                        <div className="flex flex-wrap gap-3">
                          {manualConnect.url ? (
                            <Button asChild variant="outline">
                              <a href={manualConnect.url}>Open entered server</a>
                            </Button>
                          ) : (
                            <Button disabled type="button" variant="outline">
                              Open entered server
                            </Button>
                          )}
                          {manualConnect.url ? (
                            <span className="self-center break-all text-xs text-muted-foreground">
                              {manualConnect.url}
                            </span>
                          ) : null}
                        </div>
                        {manualConnect.error ? (
                          <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
                            {manualConnect.error}
                          </div>
                        ) : null}
                      </div>
                      <Button
                        className="w-full justify-center"
                        disabled={state.loginPending}
                        size="talk"
                        type="submit"
                      >
                        {state.loginPending ? "Joining..." : "Join local intercom"}
                      </Button>
                    </form>
                  )}

                  {state.loginError ? (
                    <div className="rounded-xl border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
                      {state.loginError}
                    </div>
                  ) : null}

                  {state.realtimeError ? (
                    <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
                      {state.realtimeError}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardDescription>Before you join</CardDescription>
                  <CardTitle>Only the essentials</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm text-muted-foreground">
                  <p className="leading-6">
                    Enter the operator name, confirm the local server, and join. Audio activation,
                    mic metering, and live transport details stay out of the way until they are
                    relevant.
                  </p>
                  <div className="grid gap-3">
                    <div className="rounded-2xl border border-border/60 bg-background/35 p-4">
                      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        Live link
                      </p>
                      <p className="mt-2 font-medium text-foreground">{connectionBadge.label}</p>
                      <p className="mt-1">
                        {state.status.connectedUsers} live operator
                        {state.status.connectedUsers === 1 ? "" : "s"} on this server.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-border/60 bg-background/35 p-4">
                      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        Local URL
                      </p>
                      <a
                        className="mt-2 block break-all font-medium text-primary underline-offset-4 hover:underline"
                        href={currentConnectUrl}
                      >
                        {currentConnectUrl}
                      </a>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>
          ) : (
            <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_24rem]">
              <div className="space-y-4">
                {forceMuteNotice ? (
                  <div className="animate-pulse rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm font-medium text-warning">
                    {forceMuteNotice}
                  </div>
                ) : null}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="space-y-2">
                    <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                      Assigned channels
                    </h2>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {audioReady
                        ? "Talk, listen, and monitor controls stay centered here for live operation."
                        : "Your channel layout is ready. Arm browser audio when you are ready to go live."}
                    </p>
                  </div>
                  <Badge variant={audioStatusBadge.variant}>{audioStatusBadge.label}</Badge>
                </div>

                {(state.session?.user.role === "admin" || state.session?.user.role === "operator") ? (
                  <div className="flex items-center gap-3">
                    <Button
                      disabled={state.realtimeState !== "connected" || !audioReady || (!!allPageActive && allPageActive.userId !== state.session?.user.id)}
                      onClick={() => {
                        if (allPageActive && allPageActive.userId === state.session?.user.id) {
                          realtimeClientRef.current?.stopAllPage();
                        } else {
                          realtimeClientRef.current?.startAllPage();
                        }
                      }}
                      type="button"
                      variant={allPageActive?.userId === state.session?.user.id ? "secondary" : "outline"}
                    >
                      <Megaphone className="h-4 w-4" />
                      {allPageActive?.userId === state.session?.user.id ? "Stop All-Page" : "All-Page"}
                    </Button>
                  </div>
                ) : null}

                {allPageActive ? (
                  <div className="flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-400">
                    <span className="flex-1">📢 All-Page by {allPageActive.username}</span>
                    {allPageActive.userId === state.session?.user.id ? (
                      <Button
                        onClick={() => realtimeClientRef.current?.stopAllPage()}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        Stop
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                {incomingSignals.length > 0 ? (
                  <div className="space-y-2">
                    {incomingSignals.map((signal) => {
                      const colorClass =
                        signal.signalType === "call"
                          ? "border-red-500/50 bg-red-500/10 text-red-400"
                          : signal.signalType === "go"
                            ? "border-green-500/50 bg-green-500/10 text-green-400"
                            : "border-amber-500/50 bg-amber-500/10 text-amber-400";
                      const flash = signal.signalType === "call" || signal.signalType === "go" ? " animate-pulse" : "";

                      return (
                        <div
                          className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium${flash} ${colorClass}`}
                          key={signal.signalId}
                        >
                          <span className="flex-1">
                            {signal.signalType === "call" ? "📞" : signal.signalType === "go" ? "🟢" : "⏳"}{" "}
                            {signal.signalType.toUpperCase()} from {signal.fromUsername}
                          </span>
                          <Button
                            onClick={() => realtimeClientRef.current?.acknowledgeSignal(signal.signalId)}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            Acknowledge
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {groups.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-muted-foreground">Group:</span>
                    <button
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                        !activeGroupId
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary/50 text-foreground hover:bg-secondary"
                      }`}
                      onClick={() => setActiveGroupId(undefined)}
                      type="button"
                    >
                      All
                    </button>
                    {groups.map((group) => (
                      <button
                        className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                          activeGroupId === group.id
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary/50 text-foreground hover:bg-secondary"
                        }`}
                        key={group.id}
                        onClick={() => setActiveGroupId(group.id)}
                        type="button"
                      >
                        {group.name}
                      </button>
                    ))}
                  </div>
                ) : null}

                {incomingCall ? (
                  <div className="flex items-center gap-3 rounded-xl border border-blue-500/50 bg-blue-500/10 px-4 py-3 text-sm font-medium text-blue-400 animate-pulse">
                    <Phone className="h-4 w-4" />
                    <span className="flex-1">
                      📞 Incoming call from {incomingCall.fromUsername}
                    </span>
                    <Button
                      onClick={acceptIncomingCall}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Accept
                    </Button>
                    <Button
                      onClick={rejectIncomingCall}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Reject
                    </Button>
                  </div>
                ) : null}

                {directCall ? (
                  <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium ${
                    directCall.state === "active"
                      ? "border-green-500/50 bg-green-500/10 text-green-400"
                      : "border-blue-500/50 bg-blue-500/10 text-blue-400"
                  }`}>
                    <Phone className="h-4 w-4" />
                    <span className="flex-1">
                      {directCall.state === "active"
                        ? `🔗 Direct call with ${directCall.peerUsername}`
                        : `📞 Calling ${directCall.peerUsername}...`}
                    </span>
                    <Button
                      onClick={endCurrentDirectCall}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <PhoneOff className="h-4 w-4 mr-1" />
                      End Call
                    </Button>
                  </div>
                ) : null}

                {!directCall && !incomingCall && callableUsers.length > 0 && audioReady ? (
                  <Card>
                    <CardHeader>
                      <CardDescription>Point-to-point</CardDescription>
                      <CardTitle>Direct Call</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        {callableUsers.map((user) => (
                          <Button
                            disabled={state.realtimeState !== "connected"}
                            key={user.id}
                            onClick={() => requestDirectCall(user.id)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            <Phone className="h-3.5 w-3.5 mr-1.5" />
                            {user.username}
                          </Button>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ) : null}

                {/* IFB active indicator */}
                {ifbState ? (
                  <Card className="border-amber-500/50 bg-amber-500/10">
                    <CardContent className="flex items-center justify-between gap-4 p-4">
                      <div className="flex items-center gap-3">
                        <Headphones className="h-5 w-5 text-amber-500" />
                        <div>
                          <p className="font-semibold text-amber-200">IFB Active</p>
                          <p className="text-sm text-muted-foreground">
                            {ifbState.fromUsername} is speaking to you — program audio ducked
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ) : null}

                {/* IFB controls for admins/operators */}
                {(state.session?.user.role === "admin" || state.session?.user.role === "operator") &&
                 audioReady &&
                 callableUsers.length > 0 &&
                 !directCall ? (
                  <Card>
                    <CardHeader>
                      <CardDescription>Interrupted Fold-Back</CardDescription>
                      <CardTitle>IFB Talk</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="mb-3 text-sm text-muted-foreground">
                        Speak directly to a user while ducking their program audio.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {callableUsers.map((user) => (
                          <Button
                            disabled={state.realtimeState !== "connected"}
                            key={user.id}
                            onClick={() => realtimeClientRef.current?.startIFB(user.id)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            <Headphones className="h-3.5 w-3.5 mr-1.5" />
                            {user.username}
                          </Button>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ) : null}

                <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(24rem,1fr))]">
                  {visibleChannels.map((channel) => {
                    const permission = findPermission(assignedPermissions, channel.id);
                    const listening = listenChannelIds.includes(channel.id);
                    const talking =
                      state.operatorState?.talking &&
                      (state.operatorState.talkChannelIds.includes(channel.id) ?? false);
                    const controlsReady =
                      state.realtimeState === "connected" && !!state.operatorState && audioReady;
                    const latchModeEnabled = latchModeChannelIds.includes(channel.id);
                    const voxModeEnabled = voxModeChannelIds.includes(channel.id);
                    const allPageBlocked = !!allPageActive && allPageActive.userId !== state.session?.user.id;
                    const talkersOnChannel = remoteTalkersByChannel.get(channel.id) ?? [];
                    const monitorVolume = channelVolumes[channel.id] ?? 100;
                    const channelPan = channelPans[channel.id] ?? 0;
                    const isProgramChannel = channel.channelType === "program";
                    const isSource = isProgramChannel && channel.sourceUserId === state.session?.user.id;

                    return (
                      <Card className="overflow-hidden" key={channel.id}>
                        <div className="h-1.5 w-full" style={{ backgroundColor: channel.color }} />
                          <CardHeader className="space-y-4">
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                              <div className="min-w-0 space-y-1">
                                <div className="flex items-center gap-2">
                                  <CardTitle>{channel.name}</CardTitle>
                                  {recordingActiveIds.includes(channel.id) ? (
                                    <span className="flex items-center gap-1 rounded-full bg-danger/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-danger">
                                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
                                      REC
                                    </span>
                                  ) : null}
                                </div>
                                <p className="text-sm leading-6 text-muted-foreground">
                                {isProgramChannel
                                  ? isSource
                                    ? "You are the broadcast source for this program feed."
                                    : "Listen-only program feed."
                                  : !permission?.canTalk && permission?.canListen
                                    ? "Listen-only route."
                                    : !permission?.canListen && permission?.canTalk
                                      ? "Talk-only route."
                                      : permission?.canListen || permission?.canTalk
                                        ? controlsReady
                                          ? "Ready for live comms."
                                          : "Waiting on browser audio."
                                        : "No operator controls assigned."}
                              </p>
                            </div>
                              <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
                                {isProgramChannel ? (
                                  <Badge variant="accent">📡 Program</Badge>
                                ) : null}
                                <Badge
                                  className="min-w-[6.5rem] shrink-0 justify-center"
                                  variant={talking ? "success" : listening ? "accent" : "neutral"}
                              >
                                {talking ? "Talking" : listening ? "Listening" : "Idle"}
                              </Badge>
                              {latchModeEnabled && permission?.canTalk ? (
                                <Badge variant="accent">Latch on</Badge>
                              ) : null}
                              {voxModeEnabled && permission?.canTalk ? (
                                <Badge variant="accent">VOX</Badge>
                              ) : null}
                              <Button
                                className="relative"
                                onClick={() => openChat(channel.id)}
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                <MessageCircle className="h-4 w-4" />
                                {(unreadCounts[channel.id] ?? 0) > 0 ? (
                                  <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                                    {unreadCounts[channel.id]}
                                  </span>
                                ) : null}
                              </Button>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className={`grid gap-3 ${isProgramChannel && !isSource ? "" : "sm:grid-cols-2"}`}>
                            <Button
                              aria-pressed={listening}
                              disabled={!controlsReady || !permission?.canListen}
                              onClick={() => updateListen(channel.id, !listening)}
                              type="button"
                              variant={listening ? "secondary" : "outline"}
                            >
                              {!permission?.canListen
                                ? "Listen locked"
                                : listening
                                  ? "Listening"
                                  : "Listen off"}
                            </Button>
                            {isProgramChannel && !isSource ? null : (
                            <Button
                              aria-pressed={talking}
                              disabled={!controlsReady || !permission?.canTalk || voxModeEnabled || allPageBlocked}
                              onClick={() => {
                                if (voxModeEnabled || allPageBlocked) {
                                  return;
                                }

                                if (!latchModeEnabled) {
                                  return;
                                }

                                if (talking) {
                                  stopTalk(channel.id, true);
                                  return;
                                }

                                startTalk(channel.id);
                              }}
                              onKeyDown={(event) => {
                                if (latchModeEnabled || voxModeEnabled || allPageBlocked) {
                                  return;
                                }

                                if ((event.key === " " || event.key === "Enter") && !event.repeat) {
                                  event.preventDefault();
                                  startTalk(channel.id);
                                }
                              }}
                              onKeyUp={(event) => {
                                if (latchModeEnabled || voxModeEnabled || allPageBlocked) {
                                  return;
                                }

                                if (event.key === " " || event.key === "Enter") {
                                  event.preventDefault();
                                  stopTalk(channel.id);
                                }
                              }}
                              onPointerCancel={(event) => {
                                if (!latchModeEnabled && !voxModeEnabled && !allPageBlocked) {
                                  (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
                                  stopTalk(channel.id);
                                }
                              }}
                              onPointerDown={(event) => {
                                if (!latchModeEnabled && !voxModeEnabled && !allPageBlocked) {
                                  event.preventDefault();
                                  (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
                                  startTalk(channel.id);
                                }
                              }}
                              onPointerUp={(event) => {
                                if (!latchModeEnabled && !voxModeEnabled && !allPageBlocked) {
                                  (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
                                  stopTalk(channel.id);
                                }
                              }}
                              size="talk"
                              type="button"
                            >
                              {!permission?.canTalk
                                ? "Talk locked"
                                : allPageBlocked
                                  ? "All-Page active"
                                  : voxModeEnabled
                                    ? talking
                                      ? "VOX talking"
                                      : "VOX auto"
                                    : talking
                                      ? "Talking"
                                      : "Talk"}
                            </Button>
                            )}
                          </div>

                          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                <label htmlFor={`channel-volume-${channel.id}`}>Monitor volume</label>
                                <span>{monitorVolume}%</span>
                              </div>
                              <input
                                className={sliderClassName}
                                id={`channel-volume-${channel.id}`}
                                max={100}
                                min={0}
                                onChange={(event) =>
                                  setChannelVolumes((current) => ({
                                    ...current,
                                    [channel.id]: Number(event.target.value),
                                  }))
                                }
                                step={1}
                                type="range"
                                value={monitorVolume}
                              />
                            </div>
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                <label htmlFor={`channel-pan-${channel.id}`}>Stereo pan</label>
                                <span>{channelPan === 0 ? "C" : channelPan < 0 ? `L${Math.round(Math.abs(channelPan) * 100)}` : `R${Math.round(channelPan * 100)}`}</span>
                              </div>
                              <input
                                className={sliderClassName}
                                id={`channel-pan-${channel.id}`}
                                max={100}
                                min={-100}
                                onChange={(event) =>
                                  setChannelPans((current) => ({
                                    ...current,
                                    [channel.id]: Number(event.target.value) / 100,
                                  }))
                                }
                                step={5}
                                type="range"
                                value={Math.round(channelPan * 100)}
                              />
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                aria-pressed={!latchModeEnabled && !voxModeEnabled}
                                disabled={!permission?.canTalk}
                                onClick={() => {
                                  setLatchModeChannelIds((c) => c.filter((e) => e !== channel.id));
                                  setVoxModeChannelIds((c) => c.filter((e) => e !== channel.id));
                                }}
                                size="sm"
                                type="button"
                                variant={!latchModeEnabled && !voxModeEnabled ? "secondary" : "outline"}
                              >
                                PTT
                              </Button>
                              <Button
                                aria-pressed={latchModeEnabled}
                                disabled={!permission?.canTalk}
                                onClick={() => toggleLatchMode(channel.id)}
                                size="sm"
                                type="button"
                                variant={latchModeEnabled ? "secondary" : "outline"}
                              >
                                Latch
                              </Button>
                              <Button
                                aria-pressed={voxModeEnabled}
                                disabled={!permission?.canTalk || !audioReady}
                                onClick={() => toggleVoxMode(channel.id)}
                                size="sm"
                                type="button"
                                variant={voxModeEnabled ? "secondary" : "outline"}
                              >
                                VOX
                              </Button>
                              <div className="relative ml-auto">
                                <Button
                                  disabled={!controlsReady || !permission?.canTalk}
                                  onClick={() =>
                                    setSignalMenuChannelId(
                                      signalMenuChannelId === channel.id ? undefined : channel.id,
                                    )
                                  }
                                  size="sm"
                                  type="button"
                                  variant="ghost"
                                >
                                  Signal
                                </Button>
                                {signalMenuChannelId === channel.id ? (
                                  <div className="absolute right-0 z-10 mt-1 flex flex-col gap-1 rounded-xl border border-border bg-card p-2 shadow-lg">
                                    <Button
                                      className="justify-start text-red-400"
                                      onClick={() => sendSignalToChannel(channel.id, "call")}
                                      size="sm"
                                      type="button"
                                      variant="ghost"
                                    >
                                      📞 Call
                                    </Button>
                                    <Button
                                      className="justify-start text-amber-400"
                                      onClick={() => sendSignalToChannel(channel.id, "standby")}
                                      size="sm"
                                      type="button"
                                      variant="ghost"
                                    >
                                      ⏳ Standby
                                    </Button>
                                    <Button
                                      className="justify-start text-green-400"
                                      onClick={() => sendSignalToChannel(channel.id, "go")}
                                      size="sm"
                                      type="button"
                                      variant="ghost"
                                    >
                                      🟢 Go
                                    </Button>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>

                          <div className="rounded-2xl border border-border/60 bg-background/35 p-4">
                            <div className="flex flex-col gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                              <span className="inline-flex items-center gap-2">
                                <span
                                  aria-hidden="true"
                                  className="h-2.5 w-2.5 rounded-full"
                                  style={{ backgroundColor: channel.color }}
                                />
                                Remote talkers
                              </span>
                              <span className="shrink-0">
                                {talkersOnChannel.length ? `${talkersOnChannel.length} live` : "Silent"}
                              </span>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {talkersOnChannel.length ? (
                                talkersOnChannel.map((username) => (
                                  <Badge key={`${channel.id}-${username}`} variant="accent">
                                    {username}
                                  </Badge>
                                ))
                              ) : (
                                <span className="text-sm text-muted-foreground">
                                  No remote talkers routed here right now.
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Per-channel audio level meter */}
                          {talkersOnChannel.length > 0 ? (
                            <div className="mt-3">
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Volume2 className="h-3 w-3" />
                                <span>Channel level</span>
                                <span className="ml-auto">{remoteLevels[channel.id] ?? 0}%</span>
                              </div>
                              <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-secondary/70">
                                <div
                                  className="h-full rounded-full bg-[linear-gradient(90deg,hsl(var(--primary))_0%,#10B981_55%,#F59E0B_100%)] transition-[width] duration-150"
                                  style={{ width: `${remoteLevels[channel.id] ?? 0}%` }}
                                />
                              </div>
                            </div>
                          ) : null}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>

              {confidenceChannels.length > 0 ? (
                <div className="space-y-3">
                  <h3 className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    <Headphones className="mr-1.5 inline h-3.5 w-3.5" />
                    Confidence Feeds
                  </h3>
                  <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(20rem,1fr))]">
                    {confidenceChannels.map((channel) => {
                      const listening = listenChannelIds.includes(channel.id);
                      const monitorVolume = channelVolumes[channel.id] ?? 100;
                      return (
                        <Card className="overflow-hidden" key={channel.id}>
                          <div className="h-1.5 w-full" style={{ backgroundColor: channel.color }} />
                          <CardHeader>
                            <div className="flex items-center justify-between">
                              <div className="min-w-0 space-y-1">
                                <div className="flex items-center gap-2">
                                  <CardTitle>{channel.name}</CardTitle>
                                  {recordingActiveIds.includes(channel.id) ? (
                                    <span className="flex items-center gap-1 rounded-full bg-danger/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-danger">
                                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
                                      REC
                                    </span>
                                  ) : null}
                                </div>
                                <p className="text-sm text-muted-foreground">
                                  Always-on confidence monitor — exempt from ducking and IFB.
                                </p>
                              </div>
                              <Badge variant={listening ? "accent" : "neutral"}>
                                {listening ? "Listening" : "Idle"}
                              </Badge>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                <label htmlFor={`confidence-vol-${channel.id}`}>Volume</label>
                                <span>{monitorVolume}%</span>
                              </div>
                              <input
                                className={sliderClassName}
                                id={`confidence-vol-${channel.id}`}
                                max={100}
                                min={0}
                                onChange={(event) =>
                                  setChannelVolumes((current) => ({
                                    ...current,
                                    [channel.id]: Number(event.target.value),
                                  }))
                                }
                                step={1}
                                type="range"
                                value={monitorVolume}
                              />
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardDescription>{audioReady ? "Audio settings" : "Browser audio"}</CardDescription>
                    <CardTitle>{audioReady ? "Audio armed for comms" : "Arm browser audio"}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm leading-6 text-muted-foreground">
                      {audioReady
                        ? "Mic selection, input confidence, and monitor mix stay here while the channel grid remains focused on talk and listen."
                        : "Browser audio is only surfaced after sign-in, because that is the first moment it becomes actionable for the operator."}
                    </p>
                    {!audioReady ? (
                      <Button
                        className="w-full justify-center"
                        disabled={state.realtimeState !== "connected" || audioBusy}
                        onClick={() => void handleArmAudio()}
                        type="button"
                        variant="secondary"
                      >
                        {audioBusy
                          ? "Arming audio..."
                          : audioArmed
                            ? "Restore browser audio"
                            : "Arm audio context"}
                      </Button>
                    ) : null}
                    {audioReady ? (
                      <>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-foreground" htmlFor="mic-input">
                            Mic input
                          </label>
                          <select
                            className={inputClassName}
                            disabled={!inputDevices.length || audioBusy}
                            id="mic-input"
                            onChange={(event) => void handleInputDeviceChange(event.target.value)}
                            value={selectedInputDeviceId}
                          >
                            {inputDevices.length ? null : (
                              <option value="">Grant mic access to load inputs</option>
                            )}
                            {inputDevices.map((device) => (
                              <option key={device.deviceId} value={device.deviceId}>
                                {device.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <SignalMeter label="Mic input level" value={inputLevel} />
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            <label htmlFor="master-volume">Master monitor volume</label>
                            <span>{masterVolume}%</span>
                          </div>
                          <input
                            className={sliderClassName}
                            id="master-volume"
                            max={100}
                            min={0}
                            onChange={(event) => setMasterVolume(Number(event.target.value))}
                            step={1}
                            type="range"
                            value={masterVolume}
                          />
                        </div>
                        <div className="space-y-2">
                          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            Audio processing
                          </p>
                          <div className="grid gap-2">
                            {([
                              ["noiseSuppression", "Noise suppression"],
                              ["autoGainControl", "Auto gain control"],
                              ["echoCancellation", "Echo cancellation"],
                            ] as const).map(([key, label]) => (
                              <label
                                className="flex cursor-pointer items-center justify-between rounded-lg border border-border/60 bg-background/35 px-3 py-2"
                                key={key}
                              >
                                <span className="text-sm text-foreground">{label}</span>
                                <input
                                  checked={audioProcessing[key]}
                                  className="h-4 w-4 accent-primary"
                                  onChange={() =>
                                    setAudioProcessing((prev) => ({
                                      ...prev,
                                      [key]: !prev[key],
                                    }))
                                  }
                                  type="checkbox"
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            VOX settings
                          </p>
                          <div className="space-y-3 rounded-lg border border-border/60 bg-background/35 p-3">
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <label htmlFor="vox-threshold">Threshold</label>
                                <span>{voxSettings.thresholdDb} dB</span>
                              </div>
                              <input
                                className={sliderClassName}
                                id="vox-threshold"
                                max={-10}
                                min={-60}
                                onChange={(event) =>
                                  setVoxSettings((prev) => ({
                                    ...prev,
                                    thresholdDb: Number(event.target.value),
                                  }))
                                }
                                step={1}
                                type="range"
                                value={voxSettings.thresholdDb}
                              />
                            </div>
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <label htmlFor="vox-hold">Hold time</label>
                                <span>{voxSettings.holdTimeMs} ms</span>
                              </div>
                              <input
                                className={sliderClassName}
                                id="vox-hold"
                                max={2000}
                                min={200}
                                onChange={(event) =>
                                  setVoxSettings((prev) => ({
                                    ...prev,
                                    holdTimeMs: Number(event.target.value),
                                  }))
                                }
                                step={50}
                                type="range"
                                value={voxSettings.holdTimeMs}
                              />
                            </div>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            Sidetone (mic monitor)
                          </p>
                          <div className="space-y-3 rounded-lg border border-border/60 bg-background/35 p-3">
                            <label className="flex cursor-pointer items-center justify-between">
                              <span className="text-sm text-foreground">Enable sidetone</span>
                              <input
                                checked={sidetone.enabled}
                                className="h-4 w-4 accent-primary"
                                onChange={() =>
                                  setSidetone((prev) => ({ ...prev, enabled: !prev.enabled }))
                                }
                                type="checkbox"
                              />
                            </label>
                            {sidetone.enabled ? (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                  <label htmlFor="sidetone-level">Level</label>
                                  <span>{sidetone.level}%</span>
                                </div>
                                <input
                                  className={sliderClassName}
                                  id="sidetone-level"
                                  max={30}
                                  min={0}
                                  onChange={(event) =>
                                    setSidetone((prev) => ({
                                      ...prev,
                                      level: Number(event.target.value),
                                    }))
                                  }
                                  step={1}
                                  type="range"
                                  value={sidetone.level}
                                />
                                <p className="text-xs text-muted-foreground">
                                  Hear your own mic in your headphones. Keep below 30% to avoid feedback.
                                </p>
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            Audio ducking
                          </p>
                          <div className="space-y-3 rounded-lg border border-border/60 bg-background/35 p-3">
                            <label className="flex cursor-pointer items-center justify-between">
                              <span className="text-sm text-foreground">Enable auto-ducking</span>
                              <input
                                checked={ducking.enabled}
                                className="h-4 w-4 accent-primary"
                                onChange={() =>
                                  setDucking((prev) => ({ ...prev, enabled: !prev.enabled }))
                                }
                                type="checkbox"
                              />
                            </label>
                            {ducking.enabled ? (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                  <label htmlFor="duck-level">Duck level</label>
                                  <span>{ducking.level}%</span>
                                </div>
                                <input
                                  className={sliderClassName}
                                  id="duck-level"
                                  max={80}
                                  min={10}
                                  onChange={(event) =>
                                    setDucking((prev) => ({
                                      ...prev,
                                      level: Number(event.target.value),
                                    }))
                                  }
                                  step={5}
                                  type="range"
                                  value={ducking.level}
                                />
                                <p className="text-xs text-muted-foreground">
                                  Lower-priority channels reduce to this level when a higher-priority channel is active.
                                </p>
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            className="flex-1 justify-center"
                            disabled={profileSaving || !state.session}
                            onClick={() => void handleSaveProfile()}
                            type="button"
                            variant="outline"
                          >
                            {profileSaving ? "Saving…" : "Save profile to server"}
                          </Button>
                        </div>
                        {profileNotice ? (
                          <p className="text-center text-xs text-muted-foreground">{profileNotice}</p>
                        ) : null}
                        <Button
                          className="w-full justify-center"
                          onClick={() => void handleStartPreflight()}
                          type="button"
                          variant="secondary"
                        >
                          {preflightState.step !== "idle" && preflightState.step !== "done"
                            ? `Testing audio (${preflightState.step})...`
                            : "Test audio"}
                        </Button>
                        {preflightState.step !== "idle" ? (
                          <div className="space-y-2 rounded-xl border border-border/60 bg-background/35 p-4">
                            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                              Preflight audio test
                            </p>
                            {preflightState.step === "tone" ? (
                              <p className="text-sm text-foreground">🔊 Playing test tone — listen for a beep…</p>
                            ) : null}
                            {preflightState.step === "recording" ? (
                              <>
                                <p className="text-sm text-foreground">🎙 Recording — speak into your mic…</p>
                                <SignalMeter className="mt-1" label="Mic level" value={preflightState.micLevel} />
                              </>
                            ) : null}
                            {preflightState.step === "playback" ? (
                              <p className="text-sm text-foreground">🔈 Playing back your recording…</p>
                            ) : null}
                            {preflightState.step === "done" && preflightState.passed ? (
                              <p className="text-sm text-green-400">✓ Audio test passed</p>
                            ) : null}
                            {preflightState.step === "done" && preflightState.passed === false ? (
                              <p className="text-sm text-red-400">✗ {preflightState.error ?? "Audio test failed"}</p>
                            ) : null}
                            {preflightState.step !== "done" ? (
                              <Button
                                className="mt-2 w-full justify-center"
                                onClick={handleCancelPreflight}
                                type="button"
                                variant="ghost"
                              >
                                Cancel test
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                    {audioError ? (
                      <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
                        {audioError}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardDescription>Quick reference</CardDescription>
                    <CardTitle className="flex items-center gap-2">
                      <Keyboard className="h-4 w-4" />
                      Keyboard shortcuts
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-2 text-sm">
                      <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/35 px-3 py-2">
                        <span className="text-muted-foreground">Push-to-talk (first channel)</span>
                        <kbd className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-xs text-foreground">Space</kbd>
                      </div>
                      <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/35 px-3 py-2">
                        <span className="text-muted-foreground">Talk on channel 1–9</span>
                        <kbd className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-xs text-foreground">1</kbd>–<kbd className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-xs text-foreground">9</kbd>
                      </div>
                      <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/35 px-3 py-2">
                        <span className="text-muted-foreground">Toggle listen channel 1–9</span>
                        <kbd className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-xs text-foreground">F1</kbd>–<kbd className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-xs text-foreground">F9</kbd>
                      </div>
                      <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/35 px-3 py-2">
                        <span className="text-muted-foreground">Stop all talk</span>
                        <kbd className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-xs text-foreground">Esc</kbd>
                      </div>
                      <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/35 px-3 py-2">
                        <span className="text-muted-foreground">Headset button PTT</span>
                        <kbd className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-xs text-foreground">🎧</kbd>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Shortcuts are active when audio is armed and no input field is focused. Hold number keys for momentary PTT.
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardDescription>Alerts &amp; tones</CardDescription>
                    <CardTitle className="flex items-center gap-2">
                      🔔 Notification sounds
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Enable notification sounds</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={notificationSettings.enabled}
                        onClick={() => {
                          const next = { ...notificationSettings, enabled: !notificationSettings.enabled };
                          setNotificationSettings(next);
                          setNotificationSoundSettings(next);
                        }}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${notificationSettings.enabled ? "bg-primary" : "bg-muted"}`}
                      >
                        <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${notificationSettings.enabled ? "translate-x-5" : "translate-x-0"}`} />
                      </button>
                    </div>
                    {notificationSettings.enabled ? (
                      <>
                        <div>
                          <label className="text-xs text-muted-foreground">Alert volume</label>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={notificationSettings.volume}
                            onChange={(e) => {
                              const vol = Number(e.target.value);
                              const next = { ...notificationSettings, volume: vol };
                              setNotificationSettings(next);
                              setNotificationSoundSettings(next);
                            }}
                            className="mt-1 w-full accent-primary"
                          />
                          <span className="text-xs text-muted-foreground">{notificationSettings.volume}%</span>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">Events</p>
                          {(["call", "standby", "go", "allpage", "directCall", "chatMessage", "connectionLost", "connectionRestored", "userOnline", "pttEngage", "pttRelease"] as const).map((event) => (
                            <label key={event} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={notificationSettings.enabledEvents[event] ?? DEFAULT_NOTIFICATION_SOUND_SETTINGS.enabledEvents[event]}
                                onChange={(e) => {
                                  const next = {
                                    ...notificationSettings,
                                    enabledEvents: { ...notificationSettings.enabledEvents, [event]: e.target.checked },
                                  };
                                  setNotificationSettings(next);
                                  setNotificationSoundSettings(next);
                                }}
                                className="accent-primary"
                              />
                              <span className="text-muted-foreground">{event.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}</span>
                            </label>
                          ))}
                        </div>
                      </>
                    ) : null}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardDescription>Session overview</CardDescription>
                    <CardTitle>Live link and monitor state</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                      <div className="rounded-2xl border border-border/60 bg-background/35 p-4">
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Connection
                        </p>
                        <p className="mt-2 font-medium text-foreground">{connectionBadge.label}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {state.status.connectedUsers} live operator
                          {state.status.connectedUsers === 1 ? "" : "s"} on this server.
                        </p>
                      </div>
                      <div className="rounded-2xl border border-border/60 bg-background/35 p-4">
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Approx. browser RTT
                        </p>
                        <p className="mt-2 font-medium text-foreground">{latencyLabel}</p>
                      </div>
                      <div className="rounded-2xl border border-border/60 bg-background/35 p-4">
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Media quality
                        </p>
                        <p className={`mt-2 flex items-center gap-2 font-medium ${qualityInfo.color}`}>
                          <span className={`inline-block h-2.5 w-2.5 rounded-full ${qualityInfo.dotClass}`} />
                          {qualityInfo.label}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">{qualityInfo.detail}</p>
                        {bandwidthTier ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Codec: {bandwidthTier.bitrate / 1000}kbps{bandwidthTier.fec ? " +FEC" : ""}
                            {bandwidthTier.tier !== "good" ? ` (adapted — ${bandwidthTier.tier})` : ""}
                          </p>
                        ) : null}
                      </div>
                      <div className="rounded-2xl border border-border/60 bg-background/35 p-4">
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Monitor routes
                        </p>
                        <p className="mt-2 font-medium text-foreground">
                          {listenChannelIds.length} active listen route
                          {listenChannelIds.length === 1 ? "" : "s"}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Local volume trim follows each enabled channel.
                        </p>
                      </div>
                      <div className="rounded-2xl border border-border/60 bg-background/35 p-4">
                        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Heard now
                        </p>
                        <p className="mt-2 font-medium text-foreground">
                          {liveRemoteTalkerUsernames.length} remote talker
                          {liveRemoteTalkerUsernames.length === 1 ? "" : "s"}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Active voices currently routed into this client.
                        </p>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border/60 bg-background/35 p-4">
                      <div className="flex items-start gap-3">
                        <RadioTower className="mt-1 h-4 w-4 shrink-0 text-primary" />
                        <div className="space-y-2">
                          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            Current server
                          </p>
                          <a
                            className="break-all text-sm font-medium text-primary underline-offset-4 hover:underline"
                            href={currentConnectUrl}
                          >
                            {currentConnectUrl}
                          </a>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        <Activity className="h-3.5 w-3.5 text-primary" />
                        Live remote talkers
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {liveRemoteTalkerUsernames.length ? (
                          liveRemoteTalkerUsernames.map((username) => (
                            <Badge key={username} variant="accent">
                              {username}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            No active remote talkers right now.
                          </span>
                        )}
                      </div>
                    </div>

                    {state.realtimeError ? (
                      <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
                        {state.realtimeError}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </div>
            </section>
          )
        ) : null}
      </div>

      {chatOpen ? (() => {
        const channelName = state.session?.channels.find((c) => c.id === chatOpen)?.name ?? chatOpen;
        const msgs = chatMessages[chatOpen] ?? [];

        return (
          <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold">{channelName}</span>
                <span className="text-xs text-muted-foreground">Chat</span>
              </div>
              <Button onClick={() => setChatOpen(null)} size="sm" type="button" variant="ghost">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {msgs.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground pt-8">No messages yet. Start the conversation!</p>
              ) : (
                msgs.map((msg) => (
                  <div key={msg.id} className={`flex flex-col gap-0.5 ${msg.messageType === "system" ? "items-center" : ""}`}>
                    {msg.messageType === "system" ? (
                      <span className="text-xs italic text-muted-foreground">{msg.text}</span>
                    ) : (
                      <>
                        <div className="flex items-baseline gap-2">
                          <span className="text-xs font-semibold text-foreground">{msg.username}</span>
                          <span className="text-[10px] text-muted-foreground">{formatRelativeTime(msg.timestamp)}</span>
                        </div>
                        <p className="text-sm text-foreground">{msg.text}</p>
                      </>
                    )}
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="border-t border-border p-3">
              <form
                className="flex gap-2"
                onSubmit={(e) => { e.preventDefault(); sendChatMessage(chatOpen); }}
              >
                <input
                  autoFocus
                  className="flex-1 rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  maxLength={500}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Type a message..."
                  type="text"
                  value={chatInput}
                />
                <Button disabled={!chatInput.trim()} size="sm" type="submit" variant="default">
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </div>
          </div>
        );
      })() : null}
    </main>
  );
}
