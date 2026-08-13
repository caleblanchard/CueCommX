import type {
  CallSignalType,
  ChannelInfo,
  ConnectionQuality,
  OperatorState,
  PreflightStatus,
  ServerSignalingMessage,
  UserInfo,
  UserRole,
} from "@cuecommx/protocol";

import type { SessionStore } from "../auth/session-store.js";
import type { DatabaseService } from "../db/database.js";

import type { StepBuilder } from "./steps.js";

export type RejectionCode =
  | "capacity-reached"
  | "conflict"
  | "forbidden"
  | "invalid-message"
  | "invalid-state"
  | "media-error"
  | "not-found"
  | "unauthorized";

export type OperatorSessionDetachReason = "disconnect" | "logout" | "revoked" | "shutdown";

export type TimerType = "direct-call-timeout" | "signal-expire";

export type MediaReason =
  | "all-page"
  | "direct-call"
  | "force-mute"
  | "ifb"
  | "listen"
  | "refresh"
  | "session-attach"
  | "talk"
  | "unlatch";

export interface CoordinationSession {
  channels: ChannelInfo[];
  connectHost?: string;
  connectionQuality?: ConnectionQuality;
  preflightStatus?: PreflightStatus;
  sessionToken: string;
  state: OperatorState;
  user: UserInfo;
}

export interface AllPageState {
  previousListenStates: Map<string, string[]>;
  sessionToken: string;
  userId: string;
  username: string;
}

export interface ActiveSignal {
  fromUserId: string;
  fromUsername: string;
  signalId: string;
  signalType: CallSignalType;
  targetChannelId?: string;
  targetUserId?: string;
}

export interface DirectCall {
  callId: string;
  initiatorSessionToken: string;
  initiatorUserId: string;
  initiatorUsername: string;
  state: "active" | "ringing";
  targetSessionToken: string;
  targetUserId: string;
  targetUsername: string;
}

export interface IFBState {
  directorSessionToken: string;
  directorUserId: string;
  directorUsername: string;
  duckLevel: number;
  targetSessionToken: string;
  targetUserId: string;
}

export type TransportStep =
  | { adapter: "transport"; kind: "disconnect"; code: number; reason: string; sessionToken: string }
  | { adapter: "transport"; kind: "send"; message: ServerSignalingMessage; sessionToken: string };

export type DirectoryStep = {
  adapter: "directory";
  kind: "sync";
  channelIds: string[];
  role: UserRole;
  sessionToken: string;
  userId: string;
  username: string;
};

export type MediaRoutingStep =
  | { adapter: "media-routing"; kind: "reconcile"; reason: MediaReason; sessionToken: string }
  | { adapter: "media-routing"; kind: "register"; sessionToken: string }
  | { adapter: "media-routing"; kind: "unregister"; sessionToken: string };

export type ProjectionStep =
  | { adapter: "projection"; projection: "admin-dashboard" }
  | { adapter: "projection"; projection: "public-state" };

export type AuditStep = {
  adapter: "audit";
  channelId?: string;
  details?: string;
  eventType: string;
  userId?: string;
  username?: string;
};

export type OscStep =
  | { adapter: "osc"; kind: "all-page-start"; username: string }
  | { adapter: "osc"; kind: "all-page-stop" }
  | { adapter: "osc"; kind: "user-offline"; userId: string; username: string }
  | { adapter: "osc"; kind: "user-online"; userId: string; username: string }
  | { adapter: "osc"; channelIds: string[]; kind: "user-stopped"; userId: string }
  | { adapter: "osc"; channelId: string; kind: "user-talking"; userId: string };

export type RecordingStep = {
  adapter: "recording";
  channelIds: string[];
  mode: "start" | "stop";
  userId: string;
  username: string;
};

export type TimerStep =
  | { adapter: "timer"; key: string; kind: "cancel"; timerType: TimerType }
  | { adapter: "timer"; delayMs: number; key: string; kind: "schedule"; timerType: TimerType };

export type OperatorSessionCoordinationStep =
  | AuditStep
  | DirectoryStep
  | MediaRoutingStep
  | OscStep
  | ProjectionStep
  | RecordingStep
  | TimerStep
  | TransportStep;

export interface OperatorSessionCoordinationResult {
  decision: "accepted" | "noop" | "rejected";
  rejection?: { code: RejectionCode; message: string };
  steps: readonly OperatorSessionCoordinationStep[];
}

export type OperatorSessionCommand =
  | { type: "all-page.start" }
  | { type: "all-page.stop" }
  | { type: "direct-call.accept"; callId: string }
  | { type: "direct-call.end"; callId: string }
  | { type: "direct-call.reject"; callId: string }
  | { type: "direct-call.request"; targetUserId: string }
  | { type: "ifb.start"; targetUserId: string }
  | { type: "ifb.stop" }
  | { type: "listen.set"; channelId: string; listening: boolean }
  | { type: "preflight.report"; status: PreflightStatus }
  | { type: "quality.report"; quality: ConnectionQuality }
  | {
      type: "signal.send";
      signalType: CallSignalType;
      targetChannelId?: string;
      targetUserId?: string;
    }
  | { type: "signal.ack"; signalId: string }
  | { type: "talk.start"; channelIds: string[] }
  | { type: "talk.stop"; channelIds: string[] };

export type OperatorSessionLifecycleChange =
  | { type: "all.refresh" }
  | { type: "direct-call.timeout"; callId: string }
  | { reason: OperatorSessionDetachReason; sessionToken: string; type: "session.detach" }
  | { connectHost?: string; sessionToken: string; type: "session.attach" }
  | { signalId: string; type: "signal.expire" }
  | { type: "user.refresh"; userId: string };

export type OperatorSessionAdminCommand =
  | { type: "force-mute-user"; targetUserId: string }
  | { channelId: string; type: "unlatch-channel" };

export interface OperatorSessionProjectionSnapshot {
  allPage: { sessionToken: string; userId: string; username: string } | null;
  directCalls: DirectCall[];
  ifb: IFBState | null;
  sessions: CoordinationSession[];
}

export interface OperatorSessionMediaRoutingContext {
  channels: ChannelInfo[];
  connectHost?: string;
  directCallPeerSessionToken?: string;
  ifbPeerSessionToken?: string;
  sessionToken: string;
  state: OperatorState;
  user: UserInfo;
}

export interface OperatorSessionCoordinationOptions {
  database: DatabaseService;
  maxUsers?: number;
  sessionStore: SessionStore;
}

export interface FeatureContext {
  readonly sessions: ReadonlyMap<string, CoordinationSession>;
  accept(build: (steps: StepBuilder) => void): OperatorSessionCoordinationResult;
  noop(): OperatorSessionCoordinationResult;
  reject(code: RejectionCode, message: string, sessionToken?: string): OperatorSessionCoordinationResult;
  appendMediaRefresh(steps: StepBuilder, sessionToken: string, reason: MediaReason): void;
  appendOperatorState(steps: StepBuilder, sessionToken: string): void;
  buildOperatorState(user: UserInfo, priorState: OperatorState | undefined): OperatorState;
  findSessionByUserId(userId: string): CoordinationSession | undefined;
  refreshProjections(steps: StepBuilder): void;
}
