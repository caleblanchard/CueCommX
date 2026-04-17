import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import * as Separator from "@radix-ui/react-separator";
import { CueCommXRealtimeClient, type RealtimeConnectionState } from "@cuecommx/core";
import {
  DiscoveryResponseSchema,
  LoginResponseSchema,
  StatusResponseSchema,
  type AuthSuccessResponse,
  type ChannelPermission,
  type ConnectionQuality,
  type DiscoveryResponse,
  type OperatorState,
  type ServerSignalingMessage,
  type StatusResponse,
} from "@cuecommx/protocol";
import {
  Activity,
  Headphones,
  Keyboard,
  Mic,
  RadioTower,
  Volume2,
  Wifi,
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
  createWebMediaController,
  type MediaDeviceOption,
  type RemoteTalkerSnapshot,
  type WebMediaController,
} from "./media/web-media-controller.js";
import {
  PreflightAudioTest,
  type PreflightState,
} from "./media/preflight-audio-test.js";
import { formatLatencyIndicator, readNetworkRtt } from "./network-latency.js";
import {
  type AudioProcessingPreferences,
  clearStoredSession,
  DEFAULT_AUDIO_PROCESSING,
  hasStoredPreferredListenChannelIds,
  loadStoredSession,
  loadWebClientPreferences,
  saveStoredSession,
  saveWebClientPreferences,
  type StorageLike,
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
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality | undefined>(undefined);
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

  const connectionBadge = getConnectionBadge(state.realtimeState);
  const assignedPermissions = useMemo(
    () => state.session?.user.channelPermissions ?? [],
    [state.session?.user.channelPermissions],
  );
  const manualConnect = useMemo(() => getManualConnectState(serverUrlInput), [serverUrlInput]);
  const currentConnectUrl = state.discovery?.primaryUrl ?? window.location.origin;
  const listenChannelIds = state.operatorState?.listenChannelIds ?? [];
  const mixChannelVolumes = useMemo(
    () =>
      Object.fromEntries(
        (state.session?.channels ?? []).map((channel) => [
          channel.id,
          toFraction(channelVolumes[channel.id] ?? 100),
        ]),
      ),
    [channelVolumes, state.session?.channels],
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
      setConnectionQuality(undefined);
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
      audioProcessing,
      channelVolumes,
      latchModeChannelIds,
      masterVolume,
      preferredListenChannelIds,
      selectedInputDeviceId,
    });
  }, [
    audioProcessing,
    channelVolumes,
    hasPersistedListenPreferences,
    latchModeChannelIds,
    masterVolume,
    preferredListenChannelIds,
    selectedInputDeviceId,
    state.operatorState,
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

  useEffect(() => {
    mediaControllerRef.current?.updateMix({
      activeListenChannelIds: listenChannelIds,
      channelVolumes: mixChannelVolumes,
      masterVolume: toFraction(masterVolume),
    });
  }, [listenChannelIds, masterVolume, mixChannelVolumes]);

  useEffect(() => {
    if (!audioArmed || !mediaControllerRef.current) {
      return;
    }

    if (state.realtimeState !== "connected") {
      mediaControllerRef.current.resetConnection();
      setAudioReady(false);
      setInputLevel(0);
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
  }

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

                <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(24rem,1fr))]">
                  {(state.session?.channels ?? []).map((channel) => {
                    const permission = findPermission(assignedPermissions, channel.id);
                    const listening = listenChannelIds.includes(channel.id);
                    const talking =
                      state.operatorState?.talking &&
                      (state.operatorState.talkChannelIds.includes(channel.id) ?? false);
                    const controlsReady =
                      state.realtimeState === "connected" && !!state.operatorState && audioReady;
                    const latchModeEnabled = latchModeChannelIds.includes(channel.id);
                    const talkersOnChannel = remoteTalkersByChannel.get(channel.id) ?? [];
                    const monitorVolume = channelVolumes[channel.id] ?? 100;

                    return (
                      <Card className="overflow-hidden" key={channel.id}>
                        <div className="h-1.5 w-full" style={{ backgroundColor: channel.color }} />
                          <CardHeader className="space-y-4">
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                              <div className="min-w-0 space-y-1">
                                <CardTitle>{channel.name}</CardTitle>
                                <p className="text-sm leading-6 text-muted-foreground">
                                {!permission?.canTalk && permission?.canListen
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
                                <Badge
                                  className="min-w-[6.5rem] shrink-0 justify-center"
                                  variant={talking ? "success" : listening ? "accent" : "neutral"}
                              >
                                {talking ? "Talking" : listening ? "Listening" : "Idle"}
                              </Badge>
                              {latchModeEnabled && permission?.canTalk ? (
                                <Badge variant="accent">Latch on</Badge>
                              ) : null}
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="grid gap-3 sm:grid-cols-2">
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
                            <Button
                              aria-pressed={talking}
                              disabled={!controlsReady || !permission?.canTalk}
                              onClick={() => {
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
                                if (latchModeEnabled) {
                                  return;
                                }

                                if ((event.key === " " || event.key === "Enter") && !event.repeat) {
                                  event.preventDefault();
                                  startTalk(channel.id);
                                }
                              }}
                              onKeyUp={(event) => {
                                if (latchModeEnabled) {
                                  return;
                                }

                                if (event.key === " " || event.key === "Enter") {
                                  event.preventDefault();
                                  stopTalk(channel.id);
                                }
                              }}
                              onPointerCancel={(event) => {
                                if (!latchModeEnabled) {
                                  (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
                                  stopTalk(channel.id);
                                }
                              }}
                              onPointerDown={(event) => {
                                if (!latchModeEnabled) {
                                  event.preventDefault();
                                  (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
                                  startTalk(channel.id);
                                }
                              }}
                              onPointerUp={(event) => {
                                if (!latchModeEnabled) {
                                  (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
                                  stopTalk(channel.id);
                                }
                              }}
                              size="talk"
                              type="button"
                            >
                              {!permission?.canTalk
                                ? "Talk locked"
                                : talking
                                  ? "Talking"
                                  : "Talk"}
                            </Button>
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
                            <Button
                              aria-pressed={latchModeEnabled}
                              disabled={!permission?.canTalk}
                              onClick={() => toggleLatchMode(channel.id)}
                              type="button"
                              variant={latchModeEnabled ? "secondary" : "outline"}
                            >
                              {latchModeEnabled ? "Latch on" : "Latch off"}
                            </Button>
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
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>

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
    </main>
  );
}
