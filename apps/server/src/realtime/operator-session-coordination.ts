import { PROTOCOL_VERSION, type OperatorState, type UserInfo } from "@cuecommx/protocol";

import { AllPageFeature } from "./all-page.js";
import { CloseCodes } from "./close-codes.js";
import { DirectCallFeature } from "./direct-call.js";
import { IFBFeature } from "./ifb.js";
import { buildSignalError } from "./signal-error.js";
import { sortIds } from "./arrays.js";
import { StepBuilder } from "./steps.js";
import type {
  ActiveSignal,
  CoordinationSession,
  FeatureContext,
  MediaReason,
  OperatorSessionAdminCommand,
  OperatorSessionCommand,
  OperatorSessionCoordinationOptions,
  OperatorSessionCoordinationResult,
  OperatorSessionDetachReason,
  OperatorSessionLifecycleChange,
  OperatorSessionMediaRoutingContext,
  OperatorSessionProjectionSnapshot,
  RejectionCode,
} from "./types.js";

export class OperatorSessionCoordination {
  private readonly activeSignals = new Map<string, ActiveSignal>();

  private readonly allPage: AllPageFeature;

  private readonly directCalls: DirectCallFeature;

  private readonly ifb: IFBFeature;

  private readonly sessions = new Map<string, CoordinationSession>();

  private readonly retainedOperatorStates = new Map<string, OperatorState>();

  private signalSequence = 0;

  constructor(private readonly options: OperatorSessionCoordinationOptions) {
    const context: FeatureContext = {
      sessions: this.sessions,
      accept: (build) => this.accept(build),
      noop: () => this.noop(),
      reject: (code, message, sessionToken) => this.reject(code, message, sessionToken),
      appendMediaRefresh: (steps, sessionToken, reason) => this.appendMediaRefresh(steps, sessionToken, reason),
      appendOperatorState: (steps, sessionToken) => this.appendOperatorState(steps, sessionToken),
      buildOperatorState: (user, priorState) => this.buildOperatorState(user, priorState),
      findSessionByUserId: (userId) => this.findSessionByUserId(userId),
      refreshProjections: (steps) => this.refreshProjections(steps),
    };

    this.allPage = new AllPageFeature(context);
    this.directCalls = new DirectCallFeature(context);
    this.ifb = new IFBFeature(context);
  }

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
        return this.allPage.start(session);
      case "all-page.stop":
        return this.allPage.stop(session);
      case "signal.send":
        return this.handleSignalSend(session, input.command);
      case "signal.ack":
        return this.handleSignalAcknowledge(input.command.signalId);
      case "direct-call.request":
        return this.directCalls.request(session, input.command.targetUserId);
      case "direct-call.accept":
        return this.directCalls.accept(session, input.command.callId);
      case "direct-call.reject":
        return this.directCalls.reject(session, input.command.callId);
      case "direct-call.end":
        return this.directCalls.end(session, input.command.callId);
      case "ifb.start":
        return this.ifb.start(session, input.command.targetUserId);
      case "ifb.stop":
        return this.ifb.stop(session);
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
      allPage: this.allPage.snapshot(),
      directCalls: this.directCalls.snapshot(),
      ifb: this.ifb.snapshot(),
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
      case "user.refresh":
        return this.refreshUserSessions(input.change.userId);
      case "all.refresh":
        return this.refreshAllSessions();
      case "signal.expire":
        return this.expireSignal(input.change.signalId);
      case "direct-call.timeout":
        return this.directCalls.timeout(input.change.callId);
    }
  }

  private accept(apply: (steps: StepBuilder) => void): OperatorSessionCoordinationResult {
    const steps = new StepBuilder();
    apply(steps);
    return {
      decision: "accepted",
      steps: steps.steps,
    };
  }

  private appendDirectorySync(steps: StepBuilder, session: CoordinationSession): void {
    steps.push({
      adapter: "directory",
      kind: "sync",
      channelIds: session.channels.map((channel) => channel.id),
      role: session.user.role,
      sessionToken: session.sessionToken,
      userId: session.user.id,
      username: session.user.username,
    });
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
      message: buildSignalError(code, message, requestId),
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
    if (mode === "start" && this.allPage.blocksTalkFor(session.sessionToken)) {
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
        this.appendDirectorySync(steps, existing);
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

    const record: CoordinationSession = {
      channels,
      connectHost,
      sessionToken,
      state: nextState,
      user,
    };
    this.sessions.set(sessionToken, record);
    this.retainedOperatorStates.delete(sessionToken);

    return this.accept((steps) => {
      this.appendSessionReady(steps, sessionToken);
      this.appendDirectorySync(steps, record);
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
      directCallPeerSessionToken: this.directCalls.peerSessionTokenFor(session.sessionToken),
      ifbPeerSessionToken: this.ifb.peerSessionTokenFor(session.sessionToken),
      sessionToken: session.sessionToken,
      state: this.cloneOperatorState(session.state),
      user: this.cloneUser(session.user),
    };
  }

  private toProjectionSession(session: CoordinationSession): CoordinationSession {
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
      this.allPage.detach(sessionToken, steps);
      this.directCalls.endForSession(sessionToken, steps);
      this.ifb.endForSession(sessionToken, steps);

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

  private expireSignal(signalId: string): OperatorSessionCoordinationResult {
    if (!this.activeSignals.has(signalId)) {
      return this.noop();
    }

    return this.accept((steps) => {
      this.clearSignal(signalId, steps);
    });
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

  private refreshSessionInPlace(sessionToken: string, steps: StepBuilder): void {
    const current = this.sessions.get(sessionToken);

    if (!current) {
      return;
    }

    const user = this.options.database.getUser(current.user.id);

    if (!user) {
      steps.push({
        adapter: "transport",
        code: CloseCodes.notFound,
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
    this.appendDirectorySync(steps, current);
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
          code: code === "capacity-reached" ? CloseCodes.capacityReached : CloseCodes.unauthorized,
          kind: "disconnect",
          reason: code === "capacity-reached" ? "Server at capacity" : "Unauthorized",
          sessionToken,
        });
      }
    }

    return {
      decision: "rejected",
      rejection: { code, message },
      steps: steps.steps,
    };
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
          talking: updatedTalkChannelIds.length > 0,
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
