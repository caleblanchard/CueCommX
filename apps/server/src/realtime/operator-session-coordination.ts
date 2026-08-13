import {
  PROTOCOL_VERSION,
  type CallSignalType,
  type ChannelInfo,
  type ConnectionQuality,
  type OperatorState,
  type PreflightStatus,
  type ServerSignalingMessage,
  type UserInfo,
} from "@cuecommx/protocol";

import { SessionStore } from "../auth/session-store.js";
import { DatabaseService } from "../db/database.js";

type RejectionCode =
  | "capacity-reached"
  | "conflict"
  | "forbidden"
  | "invalid-message"
  | "invalid-state"
  | "not-found"
  | "unauthorized";

export type OperatorSessionDetachReason = "disconnect" | "logout" | "revoked" | "shutdown";
type TimerType = "direct-call-timeout" | "signal-expire";
type MediaReason =
  | "all-page"
  | "direct-call"
  | "force-mute"
  | "ifb"
  | "listen"
  | "refresh"
  | "session-attach"
  | "talk"
  | "unlatch";

interface CoordinationSession {
  channels: ChannelInfo[];
  connectHost?: string;
  connectionQuality?: ConnectionQuality;
  preflightStatus?: PreflightStatus;
  sessionToken: string;
  state: OperatorState;
  user: UserInfo;
}

interface AllPageState {
  previousListenStates: Map<string, string[]>;
  sessionToken: string;
  userId: string;
  username: string;
}

interface ActiveSignal {
  fromUserId: string;
  fromUsername: string;
  signalId: string;
  signalType: CallSignalType;
  targetChannelId?: string;
  targetUserId?: string;
}

interface DirectCall {
  callId: string;
  initiatorSessionToken: string;
  initiatorUserId: string;
  initiatorUsername: string;
  state: "active" | "ringing";
  targetSessionToken: string;
  targetUserId: string;
  targetUsername: string;
}

interface IFBState {
  directorSessionToken: string;
  directorUserId: string;
  directorUsername: string;
  duckLevel: number;
  targetSessionToken: string;
  targetUserId: string;
}

type TransportStep =
  | { adapter: "transport"; kind: "disconnect"; code: number; reason: string; sessionToken: string }
  | { adapter: "transport"; kind: "send"; message: ServerSignalingMessage; sessionToken: string };

type MediaRoutingStep =
  | { adapter: "media-routing"; kind: "reconcile"; reason: MediaReason; sessionToken: string }
  | { adapter: "media-routing"; kind: "register"; sessionToken: string }
  | { adapter: "media-routing"; kind: "unregister"; sessionToken: string };

type ProjectionStep =
  | { adapter: "projection"; projection: "admin-dashboard" }
  | { adapter: "projection"; projection: "public-state" };

type AuditStep = {
  adapter: "audit";
  channelId?: string;
  details?: string;
  eventType: string;
  userId?: string;
  username?: string;
};

type OscStep =
  | { adapter: "osc"; kind: "all-page-start"; username: string }
  | { adapter: "osc"; kind: "all-page-stop" }
  | { adapter: "osc"; kind: "user-offline"; userId: string; username: string }
  | { adapter: "osc"; kind: "user-online"; userId: string; username: string }
  | { adapter: "osc"; channelIds: string[]; kind: "user-stopped"; userId: string }
  | { adapter: "osc"; channelId: string; kind: "user-talking"; userId: string };

type RecordingStep = {
  adapter: "recording";
  channelIds: string[];
  mode: "start" | "stop";
  userId: string;
  username: string;
};

type TimerStep =
  | { adapter: "timer"; key: string; kind: "cancel"; timerType: TimerType }
  | { adapter: "timer"; delayMs: number; key: string; kind: "schedule"; timerType: TimerType };

export type OperatorSessionCoordinationStep =
  | AuditStep
  | MediaRoutingStep
  | OscStep
  | ProjectionStep
  | RecordingStep
  | TimerStep
  | TransportStep;

export interface OperatorSessionCoordinationResult {
  decision: "accepted" | "noop" | "rejected";
  rejection?: { code: RejectionCode; message: string };
  revision: number;
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
  | { sessionToken: string; type: "session.refresh" }
  | { signalId: string; type: "signal.expire" }
  | { type: "user.refresh"; userId: string };

export type OperatorSessionAdminCommand =
  | { type: "force-mute-user"; targetUserId: string }
  | { channelId: string; type: "unlatch-channel" };

export interface OperatorSessionProjectionSession {
  channels: ChannelInfo[];
  connectHost?: string;
  connectionQuality?: ConnectionQuality;
  preflightStatus?: PreflightStatus;
  sessionToken: string;
  state: OperatorState;
  user: UserInfo;
}

export interface OperatorSessionProjectionSnapshot {
  allPage: { sessionToken: string; userId: string; username: string } | null;
  directCalls: Array<{
    callId: string;
    initiatorSessionToken: string;
    initiatorUserId: string;
    initiatorUsername: string;
    state: "active" | "ringing";
    targetSessionToken: string;
    targetUserId: string;
    targetUsername: string;
  }>;
  ifb: {
    directorSessionToken: string;
    directorUserId: string;
    directorUsername: string;
    duckLevel: number;
    targetSessionToken: string;
    targetUserId: string;
  } | null;
  sessions: OperatorSessionProjectionSession[];
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

class StepBuilder {
  private readonly projectionKeys = new Set<string>();
  readonly steps: OperatorSessionCoordinationStep[] = [];

  push(step: OperatorSessionCoordinationStep): void {
    if (step.adapter === "projection") {
      const key = step.projection;

      if (this.projectionKeys.has(key)) {
        return;
      }

      this.projectionKeys.add(key);
    }

    this.steps.push(step);
  }
}

function sortIds(ids: Iterable<string>): string[] {
  return [...ids].sort((left, right) => left.localeCompare(right));
}

export class OperatorSessionCoordination {
  private static readonly DEFAULT_IFB_DUCK_LEVEL = 0.1;

  private allPageState: AllPageState | undefined;

  private readonly activeSignals = new Map<string, ActiveSignal>();

  private readonly directCalls = new Map<string, DirectCall>();

  private directCallSequence = 0;

  private ifbState: IFBState | undefined;

  private revision = 0;

  private readonly sessions = new Map<string, CoordinationSession>();

  private readonly retainedOperatorStates = new Map<string, OperatorState>();

  private signalSequence = 0;

  constructor(private readonly options: OperatorSessionCoordinationOptions) {}

  admin(input: {
    actorSessionToken?: string;
    at: number;
    command: OperatorSessionAdminCommand;
  }): OperatorSessionCoordinationResult {
    if (input.actorSessionToken) {
      const actor = this.sessions.get(input.actorSessionToken);

      if (!actor) {
        return this.reject("unauthorized", "Authenticate the realtime session first.");
      }

      if (actor.user.role !== "admin" && actor.user.role !== "operator") {
        return this.reject("forbidden", "Only admins and operators can perform that action.");
      }
    }

    return input.command.type === "force-mute-user"
      ? this.forceMuteUser(input.command.targetUserId)
      : this.unlatchChannel(input.command.channelId);
  }

  command(input: {
    actorSessionToken: string;
    at: number;
    command: OperatorSessionCommand;
  }): OperatorSessionCoordinationResult {
    const session = this.sessions.get(input.actorSessionToken);

    if (!session) {
      return this.reject("unauthorized", "Authenticate the realtime session first.");
    }

    switch (input.command.type) {
      case "listen.set":
        return this.applyListenSet(session, input.command.channelId, input.command.listening);
      case "talk.start":
        return this.applyTalkChange(session, input.command.channelIds, "start");
      case "talk.stop":
        return this.applyTalkChange(session, input.command.channelIds, "stop");
      case "quality.report":
        session.connectionQuality = input.command.quality;
        return this.accept((steps) => {
          this.refreshAdminDashboard(steps);
        });
      case "preflight.report":
        session.preflightStatus = input.command.status;
        return this.accept((steps) => {
          this.refreshAdminDashboard(steps);
        });
      case "all-page.start":
        return this.handleAllPageStart(session);
      case "all-page.stop":
        return this.handleAllPageStop(session);
      case "signal.send":
        return this.handleSignalSend(session, input.command);
      case "signal.ack":
        return this.handleSignalAcknowledge(input.command.signalId);
      case "direct-call.request":
        return this.handleDirectCallRequest(session, input.command.targetUserId);
      case "direct-call.accept":
        return this.handleDirectCallAccept(session, input.command.callId);
      case "direct-call.reject":
        return this.handleDirectCallReject(session, input.command.callId);
      case "direct-call.end":
        return this.handleDirectCallEnd(session, input.command.callId);
      case "ifb.start":
        return this.handleIfbStart(session, input.command.targetUserId);
      case "ifb.stop":
        return this.handleIfbStop(session);
    }
  }

  getConnectedUserIds(): string[] {
    return sortIds(new Set([...this.sessions.values()].map((session) => session.user.id)));
  }

  readMediaRoutingContext(sessionToken: string): OperatorSessionMediaRoutingContext | undefined {
    const session = this.sessions.get(sessionToken);

    if (!session) {
      return undefined;
    }

    return this.toMediaRoutingContext(session);
  }

  readProjectionSnapshot(): OperatorSessionProjectionSnapshot {
    return {
      allPage: this.allPageState
        ? {
            sessionToken: this.allPageState.sessionToken,
            userId: this.allPageState.userId,
            username: this.allPageState.username,
          }
        : null,
      directCalls: [...this.directCalls.values()].map((call) => ({ ...call })),
      ifb: this.ifbState ? { ...this.ifbState } : null,
      sessions: [...this.sessions.values()].map((session) => this.toProjectionSession(session)),
    };
  }

  lifecycle(input: {
    at: number;
    change: OperatorSessionLifecycleChange;
  }): OperatorSessionCoordinationResult {
    switch (input.change.type) {
      case "session.attach":
        return this.attachSession(input.change.sessionToken, input.change.connectHost);
      case "session.detach":
        return this.detachSession(input.change.sessionToken, input.change.reason);
      case "session.refresh":
        return this.refreshSession(input.change.sessionToken);
      case "user.refresh":
        return this.refreshUserSessions(input.change.userId);
      case "all.refresh":
        return this.refreshAllSessions();
      case "signal.expire":
        return this.expireSignal(input.change.signalId);
      case "direct-call.timeout":
        return this.timeoutDirectCall(input.change.callId);
    }
  }

  private accept(apply: (steps: StepBuilder) => void): OperatorSessionCoordinationResult {
    const steps = new StepBuilder();
    apply(steps);
    this.revision += 1;
    return {
      decision: "accepted",
      revision: this.revision,
      steps: steps.steps,
    };
  }

  private appendMediaRefresh(steps: StepBuilder, sessionToken: string, reason: MediaReason): void {
    if (!this.sessions.has(sessionToken)) {
      return;
    }

    steps.push({
      adapter: "media-routing",
      kind: "reconcile",
      reason,
      sessionToken,
    });
  }

  private appendOnlinePresence(steps: StepBuilder): void {
    const connectedUsers = this.getConnectedUserIds().length;
    const onlineUsers = this.listOnlineUsers();

    for (const session of this.sessions.values()) {
      steps.push({
        adapter: "transport",
        kind: "send",
        sessionToken: session.sessionToken,
        message: {
          type: "presence:update",
          payload: { connectedUsers },
        },
      });
      steps.push({
        adapter: "transport",
        kind: "send",
        sessionToken: session.sessionToken,
        message: {
          type: "online:users",
          payload: { users: onlineUsers },
        },
      });
    }
  }

  private appendOperatorState(steps: StepBuilder, sessionToken: string): void {
    const session = this.sessions.get(sessionToken);

    if (!session) {
      return;
    }

    steps.push({
      adapter: "transport",
      kind: "send",
      sessionToken,
      message: {
        type: "operator-state",
        payload: session.state,
      },
    });
  }

  private appendSessionReady(steps: StepBuilder, sessionToken: string): void {
    const session = this.sessions.get(sessionToken);

    if (!session) {
      return;
    }

    steps.push({
      adapter: "transport",
      kind: "send",
      sessionToken,
      message: {
        type: "session:ready",
        payload: {
          protocolVersion: PROTOCOL_VERSION,
          connectedUsers: this.getConnectedUserIds().length,
          user: session.user,
          channels: session.channels,
          groups: this.options.database.listGroups(),
          operatorState: session.state,
        },
      },
    });
  }

  private appendSignalError(
    steps: StepBuilder,
    sessionToken: string,
    code: RejectionCode | "media-error",
    message: string,
    requestId?: string,
  ): void {
    steps.push({
      adapter: "transport",
      kind: "send",
      sessionToken,
      message: {
        type: "signal:error",
        payload: {
          code,
          message,
          ...(requestId ? { requestId } : {}),
        },
      },
    });
  }

  private applyListenSet(
    session: CoordinationSession,
    channelId: string,
    listening: boolean,
  ): OperatorSessionCoordinationResult {
    const permission = session.user.channelPermissions.find((entry) => entry.channelId === channelId);

    if (!permission) {
      return this.reject("forbidden", "That channel is not assigned to this operator.", session.sessionToken);
    }

    if (listening && !permission.canListen) {
      return this.reject("forbidden", "This operator cannot listen to that channel.", session.sessionToken);
    }

    const nextListenChannelIds = listening
      ? sortIds(new Set([...session.state.listenChannelIds, channelId]))
      : session.state.listenChannelIds.filter((entry) => entry !== channelId);

    session.state = {
      ...session.state,
      listenChannelIds: nextListenChannelIds,
    };

    return this.accept((steps) => {
      this.appendOperatorState(steps, session.sessionToken);
      this.appendMediaRefresh(steps, session.sessionToken, "listen");
      this.refreshProjections(steps);
    });
  }

  private applyTalkChange(
    session: CoordinationSession,
    channelIds: string[],
    mode: "start" | "stop",
  ): OperatorSessionCoordinationResult {
    if (mode === "start" && this.allPageState && this.allPageState.sessionToken !== session.sessionToken) {
      return this.reject("forbidden", "Talk is disabled during All-Page broadcast.", session.sessionToken);
    }

    const permissions = new Map(
      session.user.channelPermissions.map((permission) => [permission.channelId, permission]),
    );

    for (const channelId of channelIds) {
      const permission = permissions.get(channelId);

      if (!permission || !permission.canTalk) {
        return this.reject("forbidden", "This operator cannot talk on that channel.", session.sessionToken);
      }

      if (mode === "start") {
        const channel = session.channels.find((entry) => entry.id === channelId);

        if (channel?.channelType === "program" && channel.sourceUserId !== session.user.id) {
          return this.reject(
            "forbidden",
            "Only the designated source can talk on a program channel.",
            session.sessionToken,
          );
        }
      }
    }

    const nextTalkChannelIds = mode === "start"
      ? sortIds(new Set([...session.state.talkChannelIds, ...channelIds]))
      : session.state.talkChannelIds.filter((entry) => !channelIds.includes(entry));

    session.state = {
      ...session.state,
      talkChannelIds: nextTalkChannelIds,
      talking: nextTalkChannelIds.length > 0,
    };

    return this.accept((steps) => {
      this.appendOperatorState(steps, session.sessionToken);
      this.appendMediaRefresh(steps, session.sessionToken, "talk");
      this.refreshProjections(steps);

      const eventType = mode === "start" ? "talk:start" : "talk:stop";
      for (const channelId of channelIds) {
        steps.push({
          adapter: "audit",
          channelId,
          eventType,
          userId: session.user.id,
          username: session.user.username,
        });
      }

      steps.push({
        adapter: "recording",
        channelIds: [...channelIds],
        mode,
        userId: session.user.id,
        username: session.user.username,
      });

      if (mode === "start") {
        for (const channelId of channelIds) {
          steps.push({
            adapter: "osc",
            channelId,
            kind: "user-talking",
            userId: session.user.id,
          });
        }
      } else if (nextTalkChannelIds.length === 0) {
        steps.push({
          adapter: "osc",
          channelIds: [...channelIds],
          kind: "user-stopped",
          userId: session.user.id,
        });
      }
    });
  }

  private arraysEqual(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((value, index) => value === right[index]);
  }

  private cloneOperatorState(state: OperatorState): OperatorState {
    return {
      ...state,
      listenChannelIds: [...state.listenChannelIds],
      talkChannelIds: [...state.talkChannelIds],
    };
  }

  private cloneUser(user: UserInfo): UserInfo {
    return {
      ...user,
      channelPermissions: [...user.channelPermissions],
    };
  }

  private attachSession(sessionToken: string, connectHost?: string): OperatorSessionCoordinationResult {
    const existing = this.sessions.get(sessionToken);

    if (existing) {
      existing.connectHost = connectHost;

      return this.accept((steps) => {
        this.appendSessionReady(steps, sessionToken);
      });
    }

    const session = this.options.sessionStore.get(sessionToken);

    if (!session) {
      return this.reject("unauthorized", "Session token is invalid or expired.", sessionToken, true);
    }

    const user = this.options.database.getUser(session.userId);

    if (!user) {
      return this.reject("unauthorized", "Session user was not found.", sessionToken, true);
    }

    const maxUsers = this.options.maxUsers;
    if (maxUsers !== undefined && maxUsers > 0 && this.sessions.size >= maxUsers) {
      return this.reject(
        "capacity-reached",
        `CueCommX is at capacity (${maxUsers} active session${maxUsers === 1 ? "" : "s"}).`,
        sessionToken,
        true,
      );
    }

    const channels = this.options.database.listAssignedChannels(user.id);
    const nextState = this.buildOperatorState(user, this.retainedOperatorStates.get(sessionToken));

    this.sessions.set(sessionToken, {
      channels,
      connectHost,
      sessionToken,
      state: nextState,
      user,
    });
    this.retainedOperatorStates.delete(sessionToken);

    return this.accept((steps) => {
      this.appendSessionReady(steps, sessionToken);
      steps.push({
        adapter: "media-routing",
        kind: "register",
        sessionToken,
      });
      this.appendOnlinePresence(steps);
      this.refreshProjections(steps);
      steps.push({
        adapter: "audit",
        eventType: "user:connected",
        userId: user.id,
        username: user.username,
      });
      steps.push({
        adapter: "osc",
        kind: "user-online",
        userId: user.id,
        username: user.username,
      });
    });
  }

  private buildOperatorState(user: UserInfo, priorState: OperatorState | undefined): OperatorState {
    const permissions = new Map(
      user.channelPermissions.map((permission) => [permission.channelId, permission]),
    );
    const fallbackState: OperatorState =
      priorState ?? {
        talkChannelIds: [],
        listenChannelIds: sortIds(
          user.channelPermissions
            .filter((permission) => permission.canListen)
            .map((permission) => permission.channelId),
        ),
        talking: false,
      };
    const talkChannelIds = sortIds(
      fallbackState.talkChannelIds.filter((channelId) => permissions.get(channelId)?.canTalk),
    );
    const listenChannelIds = sortIds(
      fallbackState.listenChannelIds.filter((channelId) => permissions.get(channelId)?.canListen),
    );

    return {
      listenChannelIds,
      talkChannelIds,
      talking: talkChannelIds.length > 0,
    };
  }

  private toMediaRoutingContext(session: CoordinationSession): OperatorSessionMediaRoutingContext {
    return {
      channels: [...session.channels],
      connectHost: session.connectHost,
      directCallPeerSessionToken: this.getDirectCallPeerSessionToken(session.sessionToken),
      ifbPeerSessionToken: this.getIfbPeerSessionToken(session.sessionToken),
      sessionToken: session.sessionToken,
      state: this.cloneOperatorState(session.state),
      user: this.cloneUser(session.user),
    };
  }

  private toProjectionSession(session: CoordinationSession): OperatorSessionProjectionSession {
    return {
      channels: [...session.channels],
      connectHost: session.connectHost,
      connectionQuality: session.connectionQuality,
      preflightStatus: session.preflightStatus,
      sessionToken: session.sessionToken,
      state: this.cloneOperatorState(session.state),
      user: this.cloneUser(session.user),
    };
  }

  private clearSignal(signalId: string, steps: StepBuilder): void {
    const signal = this.activeSignals.get(signalId);

    if (!signal) {
      return;
    }

    this.activeSignals.delete(signalId);
    steps.push({
      adapter: "timer",
      key: signalId,
      kind: "cancel",
      timerType: "signal-expire",
    });

    for (const session of this.sessions.values()) {
      steps.push({
        adapter: "transport",
        kind: "send",
        sessionToken: session.sessionToken,
        message: {
          type: "signal:cleared",
          payload: { signalId },
        },
      });
    }
  }

  private detachSession(
    sessionToken: string,
    reason: OperatorSessionDetachReason,
  ): OperatorSessionCoordinationResult {
    const session = this.sessions.get(sessionToken);

    if (!session) {
      return this.noop();
    }

    return this.accept((steps) => {
      if (this.allPageState?.sessionToken === sessionToken) {
        this.restoreAllPageListeners(this.allPageState.previousListenStates, sessionToken, steps);
        this.allPageState = undefined;

        for (const current of this.sessions.values()) {
          if (current.sessionToken === sessionToken) {
            continue;
          }

          steps.push({
            adapter: "transport",
            kind: "send",
            sessionToken: current.sessionToken,
            message: {
              type: "allpage:inactive",
              payload: {},
            },
          });
        }
      }

      const activeCall = this.findDirectCallForSession(sessionToken);
      if (activeCall) {
        this.endDirectCall(activeCall.callId, "ended", steps);
      }

      if (
        this.ifbState &&
        (this.ifbState.directorSessionToken === sessionToken || this.ifbState.targetSessionToken === sessionToken)
      ) {
        this.endIfb(steps);
      }

      for (const signal of [...this.activeSignals.values()]) {
        if (signal.targetUserId === session.user.id || signal.fromUserId === session.user.id) {
          this.clearSignal(signal.signalId, steps);
        }
      }

      steps.push({
        adapter: "audit",
        eventType: "user:disconnected",
        userId: session.user.id,
        username: session.user.username,
      });
      steps.push({
        adapter: "osc",
        kind: "user-offline",
        userId: session.user.id,
        username: session.user.username,
      });
      steps.push({
        adapter: "media-routing",
        kind: "unregister",
        sessionToken,
      });

      if (reason === "disconnect") {
        this.retainedOperatorStates.set(sessionToken, {
          ...this.cloneOperatorState(session.state),
          talkChannelIds: [],
          talking: false,
        });
      } else {
        this.retainedOperatorStates.delete(sessionToken);
      }

      this.sessions.delete(sessionToken);
      this.appendOnlinePresence(steps);
      this.refreshProjections(steps);
    });
  }

  private endDirectCall(
    callId: string,
    reason: "busy" | "ended" | "rejected" | "unavailable",
    steps: StepBuilder,
  ): void {
    const call = this.directCalls.get(callId);

    if (!call) {
      return;
    }

    const wasActive = call.state === "active";
    this.directCalls.delete(callId);
    steps.push({
      adapter: "timer",
      key: callId,
      kind: "cancel",
      timerType: "direct-call-timeout",
    });

    const sessionTokens = [call.initiatorSessionToken, call.targetSessionToken];
    for (const sessionToken of sessionTokens) {
      if (!this.sessions.has(sessionToken)) {
        continue;
      }

      steps.push({
        adapter: "transport",
        kind: "send",
        sessionToken,
        message: {
          type: "direct:ended",
          payload: { callId, reason },
        },
      });
    }

    if (wasActive) {
      for (const sessionToken of sessionTokens) {
        this.appendMediaRefresh(steps, sessionToken, "direct-call");
      }

      this.refreshProjections(steps);
    }
  }

  private endIfb(steps: StepBuilder): void {
    if (!this.ifbState) {
      return;
    }

    const current = this.ifbState;
    this.ifbState = undefined;

    if (this.sessions.has(current.targetSessionToken)) {
      steps.push({
        adapter: "transport",
        kind: "send",
        sessionToken: current.targetSessionToken,
        message: {
          type: "ifb:inactive",
          payload: {},
        },
      });
      this.appendMediaRefresh(steps, current.targetSessionToken, "ifb");
    }

    this.appendMediaRefresh(steps, current.directorSessionToken, "ifb");
    this.refreshProjections(steps);
  }

  private expireSignal(signalId: string): OperatorSessionCoordinationResult {
    if (!this.activeSignals.has(signalId)) {
      return this.noop();
    }

    return this.accept((steps) => {
      this.clearSignal(signalId, steps);
    });
  }

  private findDirectCallForSession(sessionToken: string): DirectCall | undefined {
    return [...this.directCalls.values()].find(
      (call) => call.initiatorSessionToken === sessionToken || call.targetSessionToken === sessionToken,
    );
  }

  private findSessionByUserId(userId: string): CoordinationSession | undefined {
    return [...this.sessions.values()].find((session) => session.user.id === userId);
  }

  private forceMuteUser(targetUserId: string): OperatorSessionCoordinationResult {
    const targets = [...this.sessions.values()].filter(
      (session) => session.user.id === targetUserId && session.state.talkChannelIds.length > 0,
    );

    if (targets.length === 0) {
      return this.noop();
    }

    return this.accept((steps) => {
      for (const session of targets) {
        session.state = {
          ...session.state,
          talkChannelIds: [],
          talking: false,
        };
        this.appendOperatorState(steps, session.sessionToken);
        steps.push({
          adapter: "transport",
          kind: "send",
          sessionToken: session.sessionToken,
          message: {
            type: "force-muted",
            payload: { reason: "user" },
          },
        });
        this.appendMediaRefresh(steps, session.sessionToken, "force-mute");
      }

      this.refreshProjections(steps);
    });
  }

  private getDirectCallPeerSessionToken(sessionToken: string): string | undefined {
    const call = this.findDirectCallForSession(sessionToken);

    if (!call || call.state !== "active") {
      return undefined;
    }

    return call.initiatorSessionToken === sessionToken
      ? call.targetSessionToken
      : call.initiatorSessionToken;
  }

  private getIfbPeerSessionToken(sessionToken: string): string | undefined {
    if (this.ifbState?.targetSessionToken === sessionToken) {
      return this.ifbState.directorSessionToken;
    }

    return undefined;
  }

  private handleAllPageStart(session: CoordinationSession): OperatorSessionCoordinationResult {
    if (session.user.role !== "admin" && session.user.role !== "operator") {
      return this.reject("forbidden", "Only admins and operators can start All-Page.", session.sessionToken);
    }

    if (this.allPageState) {
      return this.reject("conflict", "An All-Page broadcast is already active.", session.sessionToken);
    }

    const previousListenStates = new Map<string, string[]>();

    return this.accept((steps) => {
      for (const current of this.sessions.values()) {
        if (current.sessionToken === session.sessionToken) {
          continue;
        }

        if (current.state.talkChannelIds.length > 0) {
          current.state = {
            ...current.state,
            talkChannelIds: [],
            talking: false,
          };
          this.appendOperatorState(steps, current.sessionToken);
          this.appendMediaRefresh(steps, current.sessionToken, "all-page");
        }
      }

      this.allPageState = {
        previousListenStates,
        sessionToken: session.sessionToken,
        userId: session.user.id,
        username: session.user.username,
      };

      const allTalkChannelIds = sortIds(
        session.user.channelPermissions
          .filter((permission) => permission.canTalk)
          .map((permission) => permission.channelId),
      );
      if (!this.arraysEqual(allTalkChannelIds, session.state.talkChannelIds)) {
        session.state = {
          ...session.state,
          talkChannelIds: allTalkChannelIds,
          talking: allTalkChannelIds.length > 0,
        };
        this.appendOperatorState(steps, session.sessionToken);
        this.appendMediaRefresh(steps, session.sessionToken, "all-page");
      }

      for (const current of this.sessions.values()) {
        if (current.sessionToken === session.sessionToken) {
          continue;
        }

        previousListenStates.set(current.sessionToken, [...current.state.listenChannelIds]);
        const allListenChannelIds = sortIds(
          new Set(
            current.user.channelPermissions
              .filter((permission) => permission.canListen)
              .map((permission) => permission.channelId),
          ),
        );
        const merged = sortIds(new Set([...current.state.listenChannelIds, ...allListenChannelIds]));

        if (!this.arraysEqual(merged, current.state.listenChannelIds)) {
          current.state = {
            ...current.state,
            listenChannelIds: merged,
          };
          this.appendMediaRefresh(steps, current.sessionToken, "all-page");
        }
      }

      for (const current of this.sessions.values()) {
        steps.push({
          adapter: "transport",
          kind: "send",
          sessionToken: current.sessionToken,
          message: {
            type: "allpage:active",
            payload: {
              userId: session.user.id,
              username: session.user.username,
            },
          },
        });
      }

      this.refreshProjections(steps);
      steps.push({
        adapter: "audit",
        eventType: "allpage:start",
        userId: session.user.id,
        username: session.user.username,
      });
      steps.push({
        adapter: "osc",
        kind: "all-page-start",
        username: session.user.username,
      });
    });
  }

  private handleAllPageStop(session: CoordinationSession): OperatorSessionCoordinationResult {
    if (!this.allPageState) {
      return this.reject("invalid-state", "No All-Page broadcast is active.", session.sessionToken);
    }

    if (this.allPageState.sessionToken !== session.sessionToken && session.user.role !== "admin") {
      return this.reject("forbidden", "Only the pager or an admin can stop All-Page.", session.sessionToken);
    }

    return this.accept((steps) => {
      const pager = this.sessions.get(this.allPageState!.sessionToken);
      if (pager) {
        pager.state = {
          ...pager.state,
          talkChannelIds: [],
          talking: false,
        };
        this.appendOperatorState(steps, pager.sessionToken);
        this.appendMediaRefresh(steps, pager.sessionToken, "all-page");
      }

      this.restoreAllPageListeners(this.allPageState!.previousListenStates, this.allPageState!.sessionToken, steps);
      this.allPageState = undefined;

      for (const current of this.sessions.values()) {
        steps.push({
          adapter: "transport",
          kind: "send",
          sessionToken: current.sessionToken,
          message: {
            type: "allpage:inactive",
            payload: {},
          },
        });
      }

      this.refreshProjections(steps);
      steps.push({
        adapter: "audit",
        eventType: "allpage:stop",
        userId: session.user.id,
        username: session.user.username,
      });
      steps.push({
        adapter: "osc",
        kind: "all-page-stop",
      });
    });
  }

  private handleDirectCallAccept(session: CoordinationSession, callId: string): OperatorSessionCoordinationResult {
    const call = this.directCalls.get(callId);

    if (!call || call.state !== "ringing") {
      return this.reject("invalid-state", "No ringing call found with that ID.", session.sessionToken);
    }

    if (call.targetSessionToken !== session.sessionToken) {
      return this.reject("forbidden", "Only the call target can accept.", session.sessionToken);
    }

    return this.accept((steps) => {
      call.state = "active";
      steps.push({
        adapter: "timer",
        key: callId,
        kind: "cancel",
        timerType: "direct-call-timeout",
      });

      if (this.sessions.has(call.initiatorSessionToken)) {
        steps.push({
          adapter: "transport",
          kind: "send",
          sessionToken: call.initiatorSessionToken,
          message: {
            type: "direct:active",
            payload: {
              callId,
              peerUserId: session.user.id,
              peerUsername: session.user.username,
            },
          },
        });
        this.appendMediaRefresh(steps, call.initiatorSessionToken, "direct-call");
      }

      steps.push({
        adapter: "transport",
        kind: "send",
        sessionToken: session.sessionToken,
        message: {
          type: "direct:active",
          payload: {
            callId,
            peerUserId: call.initiatorUserId,
            peerUsername: call.initiatorUsername,
          },
        },
      });
      this.appendMediaRefresh(steps, session.sessionToken, "direct-call");
      this.refreshProjections(steps);
    });
  }

  private handleDirectCallEnd(session: CoordinationSession, callId: string): OperatorSessionCoordinationResult {
    const call = this.directCalls.get(callId);

    if (!call) {
      return this.reject("invalid-state", "No call found with that ID.", session.sessionToken);
    }

    if (call.initiatorSessionToken !== session.sessionToken && call.targetSessionToken !== session.sessionToken) {
      return this.reject("forbidden", "You are not part of this call.", session.sessionToken);
    }

    return this.accept((steps) => {
      this.endDirectCall(callId, "ended", steps);
    });
  }

  private handleDirectCallReject(session: CoordinationSession, callId: string): OperatorSessionCoordinationResult {
    const call = this.directCalls.get(callId);

    if (!call || call.state !== "ringing") {
      return this.reject("invalid-state", "No ringing call found with that ID.", session.sessionToken);
    }

    if (call.targetSessionToken !== session.sessionToken) {
      return this.reject("forbidden", "Only the call target can reject.", session.sessionToken);
    }

    return this.accept((steps) => {
      this.endDirectCall(callId, "rejected", steps);
    });
  }

  private handleDirectCallRequest(session: CoordinationSession, targetUserId: string): OperatorSessionCoordinationResult {
    if (targetUserId === session.user.id) {
      return this.reject("invalid-message", "Cannot call yourself.", session.sessionToken);
    }

    if (this.findDirectCallForSession(session.sessionToken)) {
      return this.reject("conflict", "You are already in a direct call.", session.sessionToken);
    }

    const target = this.findSessionByUserId(targetUserId);

    if (!target) {
      return this.accept((steps) => {
        steps.push({
          adapter: "transport",
          kind: "send",
          sessionToken: session.sessionToken,
          message: {
            type: "direct:ended",
            payload: { callId: "", reason: "unavailable" },
          },
        });
      });
    }

    if (this.findDirectCallForSession(target.sessionToken)) {
      return this.accept((steps) => {
        steps.push({
          adapter: "transport",
          kind: "send",
          sessionToken: session.sessionToken,
          message: {
            type: "direct:ended",
            payload: { callId: "", reason: "busy" },
          },
        });
      });
    }

    return this.accept((steps) => {
      this.directCallSequence += 1;
      const callId = `dc-${this.directCallSequence}-${Date.now()}`;

      this.directCalls.set(callId, {
        callId,
        initiatorSessionToken: session.sessionToken,
        initiatorUserId: session.user.id,
        initiatorUsername: session.user.username,
        state: "ringing",
        targetSessionToken: target.sessionToken,
        targetUserId,
        targetUsername: target.user.username,
      });

      steps.push({
        adapter: "timer",
        delayMs: 30_000,
        key: callId,
        kind: "schedule",
        timerType: "direct-call-timeout",
      });
      steps.push({
        adapter: "transport",
        kind: "send",
        sessionToken: target.sessionToken,
        message: {
          type: "direct:incoming",
          payload: {
            callId,
            fromUserId: session.user.id,
            fromUsername: session.user.username,
          },
        },
      });
    });
  }

  private handleIfbStart(session: CoordinationSession, targetUserId: string): OperatorSessionCoordinationResult {
    if (session.user.role !== "admin" && session.user.role !== "operator") {
      return this.reject("forbidden", "Only admins and operators can use IFB.", session.sessionToken);
    }

    if (targetUserId === session.user.id) {
      return this.reject("invalid-message", "Cannot IFB yourself.", session.sessionToken);
    }

    if (this.ifbState) {
      return this.reject("conflict", "An IFB session is already active.", session.sessionToken);
    }

    const target = this.findSessionByUserId(targetUserId);

    if (!target) {
      return this.reject("invalid-state", "Target user is not online.", session.sessionToken);
    }

    return this.accept((steps) => {
      this.ifbState = {
        directorSessionToken: session.sessionToken,
        directorUserId: session.user.id,
        directorUsername: session.user.username,
        duckLevel: OperatorSessionCoordination.DEFAULT_IFB_DUCK_LEVEL,
        targetSessionToken: target.sessionToken,
        targetUserId,
      };

      steps.push({
        adapter: "transport",
        kind: "send",
        sessionToken: target.sessionToken,
        message: {
          type: "ifb:active",
          payload: {
            fromUserId: session.user.id,
            fromUsername: session.user.username,
            duckLevel: OperatorSessionCoordination.DEFAULT_IFB_DUCK_LEVEL,
          },
        },
      });
      this.appendMediaRefresh(steps, session.sessionToken, "ifb");
      this.appendMediaRefresh(steps, target.sessionToken, "ifb");
      this.refreshProjections(steps);
    });
  }

  private handleIfbStop(session: CoordinationSession): OperatorSessionCoordinationResult {
    if (!this.ifbState) {
      return this.reject("invalid-state", "No IFB session is active.", session.sessionToken);
    }

    if (this.ifbState.directorSessionToken !== session.sessionToken && session.user.role !== "admin") {
      return this.reject("forbidden", "Only the IFB director or an admin can stop IFB.", session.sessionToken);
    }

    return this.accept((steps) => {
      this.endIfb(steps);
    });
  }

  private handleSignalAcknowledge(signalId: string): OperatorSessionCoordinationResult {
    if (!this.activeSignals.has(signalId)) {
      return this.noop();
    }

    return this.accept((steps) => {
      this.clearSignal(signalId, steps);
    });
  }

  private handleSignalSend(
    session: CoordinationSession,
    command: Extract<OperatorSessionCommand, { type: "signal.send" }>,
  ): OperatorSessionCoordinationResult {
    if (!command.targetChannelId && !command.targetUserId) {
      return this.reject("invalid-message", "Signal must target a channel or user.", session.sessionToken);
    }

    if (command.targetChannelId) {
      const permission = session.user.channelPermissions.find(
        (entry) => entry.channelId === command.targetChannelId,
      );

      if (!permission?.canTalk && session.user.role !== "admin" && session.user.role !== "operator") {
        return this.reject("forbidden", "Cannot send signal to that channel.", session.sessionToken);
      }
    }

    if (command.targetUserId && session.user.role !== "admin" && session.user.role !== "operator") {
      return this.reject("forbidden", "Only admins and operators can signal specific users.", session.sessionToken);
    }

    return this.accept((steps) => {
      this.signalSequence += 1;
      const signalId = `sig-${this.signalSequence}-${Date.now()}`;

      this.activeSignals.set(signalId, {
        fromUserId: session.user.id,
        fromUsername: session.user.username,
        signalId,
        signalType: command.signalType,
        targetChannelId: command.targetChannelId,
        targetUserId: command.targetUserId,
      });

      steps.push({
        adapter: "timer",
        delayMs: 30_000,
        key: signalId,
        kind: "schedule",
        timerType: "signal-expire",
      });

      for (const current of this.sessions.values()) {
        if (current.user.id === session.user.id) {
          continue;
        }

        if (command.targetUserId) {
          if (current.user.id !== command.targetUserId) {
            continue;
          }
        } else if (command.targetChannelId) {
          const hasPermission = current.user.channelPermissions.some(
            (permission) => permission.channelId === command.targetChannelId && permission.canListen,
          );

          if (!hasPermission) {
            continue;
          }
        }

        steps.push({
          adapter: "transport",
          kind: "send",
          sessionToken: current.sessionToken,
          message: {
            type: "signal:incoming",
            payload: {
              signalId,
              signalType: command.signalType,
              fromUserId: session.user.id,
              fromUsername: session.user.username,
              targetChannelId: command.targetChannelId,
            },
          },
        });
      }
    });
  }

  private listOnlineUsers(): Array<{ id: string; username: string }> {
    const usersById = new Map<string, { id: string; username: string }>();

    for (const session of this.sessions.values()) {
      usersById.set(session.user.id, {
        id: session.user.id,
        username: session.user.username,
      });
    }

    return [...usersById.values()].sort((left, right) => left.username.localeCompare(right.username));
  }

  private noop(): OperatorSessionCoordinationResult {
    return {
      decision: "noop",
      revision: this.revision,
      steps: [],
    };
  }

  private refreshAllSessions(): OperatorSessionCoordinationResult {
    const sessionTokens = [...this.sessions.keys()];
    if (sessionTokens.length === 0) {
      return this.noop();
    }

    return this.accept((steps) => {
      for (const sessionToken of sessionTokens) {
        this.refreshSessionInPlace(sessionToken, steps);
      }
    });
  }

  private refreshProjections(steps: StepBuilder): void {
    this.refreshAdminDashboard(steps);
    this.refreshPublicState(steps);
  }

  private refreshAdminDashboard(steps: StepBuilder): void {
    steps.push({
      adapter: "projection",
      projection: "admin-dashboard",
    });
  }

  private refreshPublicState(steps: StepBuilder): void {
    steps.push({
      adapter: "projection",
      projection: "public-state",
    });
  }

  private refreshSession(sessionToken: string): OperatorSessionCoordinationResult {
    if (!this.sessions.has(sessionToken)) {
      return this.noop();
    }

    return this.accept((steps) => {
      this.refreshSessionInPlace(sessionToken, steps);
    });
  }

  private refreshSessionInPlace(sessionToken: string, steps: StepBuilder): void {
    const current = this.sessions.get(sessionToken);

    if (!current) {
      return;
    }

    const user = this.options.database.getUser(current.user.id);

    if (!user) {
      steps.push({
        adapter: "transport",
        code: 4404,
        kind: "disconnect",
        reason: "Session user was removed.",
        sessionToken,
      });
      return;
    }

    current.user = user;
    current.channels = this.options.database.listAssignedChannels(user.id);
    current.state = this.buildOperatorState(user, current.state);

    this.appendSessionReady(steps, sessionToken);
    this.appendMediaRefresh(steps, sessionToken, "refresh");
    this.refreshProjections(steps);
  }

  private refreshUserSessions(userId: string): OperatorSessionCoordinationResult {
    const sessionTokens = [...this.sessions.values()]
      .filter((session) => session.user.id === userId)
      .map((session) => session.sessionToken);

    if (sessionTokens.length === 0) {
      return this.accept((steps) => {
        this.refreshAdminDashboard(steps);
      });
    }

    return this.accept((steps) => {
      for (const sessionToken of sessionTokens) {
        this.refreshSessionInPlace(sessionToken, steps);
      }
    });
  }

  private reject(
    code: RejectionCode,
    message: string,
    sessionToken?: string,
    disconnect: boolean = false,
  ): OperatorSessionCoordinationResult {
    const steps = new StepBuilder();

    if (sessionToken) {
      this.appendSignalError(steps, sessionToken, code, message);
      if (disconnect) {
        steps.push({
          adapter: "transport",
          code: code === "capacity-reached" ? 4429 : 4401,
          kind: "disconnect",
          reason: code === "capacity-reached" ? "Server at capacity" : "Unauthorized",
          sessionToken,
        });
      }
    }

    return {
      decision: "rejected",
      rejection: { code, message },
      revision: this.revision,
      steps: steps.steps,
    };
  }

  private restoreAllPageListeners(
    previousListenStates: ReadonlyMap<string, string[]>,
    pagerSessionToken: string,
    steps: StepBuilder,
  ): void {
    for (const session of this.sessions.values()) {
      if (session.sessionToken === pagerSessionToken) {
        continue;
      }

      const restoredState = this.buildOperatorState(session.user, session.state);
      const priorListenChannelIds = previousListenStates.get(session.sessionToken);

      session.state = {
        ...restoredState,
        listenChannelIds: priorListenChannelIds
          ? this.sanitizeListenChannelIds(session.user, priorListenChannelIds)
          : restoredState.listenChannelIds,
      };
      this.appendOperatorState(steps, session.sessionToken);
      this.appendMediaRefresh(steps, session.sessionToken, "all-page");
    }
  }

  private sanitizeListenChannelIds(user: UserInfo, channelIds: readonly string[]): string[] {
    const allowedListenChannelIds = new Set(
      user.channelPermissions
        .filter((permission) => permission.canListen)
        .map((permission) => permission.channelId),
    );

    return sortIds(new Set(channelIds.filter((channelId) => allowedListenChannelIds.has(channelId))));
  }

  private timeoutDirectCall(callId: string): OperatorSessionCoordinationResult {
    const call = this.directCalls.get(callId);

    if (!call || call.state !== "ringing") {
      return this.noop();
    }

    return this.accept((steps) => {
      this.endDirectCall(callId, "unavailable", steps);
    });
  }

  private unlatchChannel(channelId: string): OperatorSessionCoordinationResult {
    const targets = [...this.sessions.values()].filter((session) =>
      session.state.talkChannelIds.includes(channelId)
    );

    if (targets.length === 0) {
      return this.noop();
    }

    return this.accept((steps) => {
      for (const session of targets) {
        const updatedTalkChannelIds = session.state.talkChannelIds.filter((id) => id !== channelId);

        session.state = {
          ...session.state,
          talkChannelIds: updatedTalkChannelIds,
          talking: updatedTalkChannelIds.length > 0 && session.state.talking,
        };
        this.appendOperatorState(steps, session.sessionToken);
        steps.push({
          adapter: "transport",
          kind: "send",
          sessionToken: session.sessionToken,
          message: {
            type: "force-muted",
            payload: { reason: "channel", channelId },
          },
        });
        this.appendMediaRefresh(steps, session.sessionToken, "unlatch");
      }

      this.refreshProjections(steps);
    });
  }
}
