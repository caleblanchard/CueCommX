import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import type { Socket } from "node:net";

import {
  parseClientSignalingMessage,
  type CallSignalType,
  type ClientSignalingMessage,
  type ConnectionQuality,
  type OperatorState,
  type PreflightStatus,
  type ServerSignalingMessage,
  type TallySourceState,
  type UserRole,
} from "@cuecommx/protocol";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import { SessionStore } from "../auth/session-store.js";
import { DatabaseService } from "../db/database.js";
import type { MediaRequestMessage, RealtimeMediaService } from "../media/service.js";
import type { OscService } from "../osc/service.js";
import type { RecordingService } from "../recording/service.js";
import type { TallyService } from "../tally/service.js";

import { ChannelChatModule, type ChannelChatResult } from "./channel-chat.js";
import { CloseCodes } from "./close-codes.js";
import {
  ConnectionRegistry,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  isUsableMediaHost,
  parseRequestHost,
  resolveMediaHost,
  type ConnectionRecord,
} from "./connections.js";
import { toCoordinationCommand } from "./commands.js";
import { MediaRoutingModule, type MediaRoutingResult } from "./media-routing.js";
import { OperatorSessionCoordination } from "./operator-session-coordination.js";
import type {
  OperatorSessionAdminCommand,
  OperatorSessionCoordinationResult,
  OperatorSessionCoordinationStep,
  OperatorSessionDetachReason,
  OperatorSessionLifecycleChange,
  RejectionCode,
} from "./types.js";
import {
  buildAdminDashboardSnapshot,
  buildStreamDeckPublicState,
  type StreamDeckPublicState,
} from "./projections.js";
import { buildSignalError } from "./signal-error.js";

interface SessionDirectoryEntry {
  channelIds: string[];
  role: UserRole;
  userId: string;
  username: string;
}

export interface RealtimeServiceOptions {
  database: DatabaseService;
  heartbeatIntervalMs?: number;
  maxUsers?: number;
  mediaService?: RealtimeMediaService;
  oscService?: OscService;
  path?: string;
  recordingService?: RecordingService;
  sessionStore: SessionStore;
  tallyService?: TallyService;
  onStateChange?: () => void;
}

const DEFAULT_PATH = "/ws";

export class RealtimeService {
  private readonly chat = new ChannelChatModule();

  private closing = false;

  private readonly connections: ConnectionRegistry;

  private readonly coordination: OperatorSessionCoordination;

  private readonly mediaRouting: MediaRoutingModule;

  private outcomeQueue: Promise<void> = Promise.resolve();

  private readonly sessionDirectory = new Map<string, SessionDirectoryEntry>();

  private readonly path: string;

  private readonly server = new WebSocketServer({ noServer: true });

  private readonly timers = {
    directCallTimeout: new Map<string, ReturnType<typeof setTimeout>>(),
    signalExpire: new Map<string, ReturnType<typeof setTimeout>>(),
  };

  private readonly kickedSessionTokens = new Set<string>();

  constructor(private readonly options: RealtimeServiceOptions) {
    this.coordination = new OperatorSessionCoordination({
      database: options.database,
      maxUsers: options.maxUsers,
      sessionStore: options.sessionStore,
    });
    this.mediaRouting = new MediaRoutingModule({
      mediaService: options.mediaService,
    });
    this.path = options.path ?? DEFAULT_PATH;
    this.connections = new ConnectionRegistry(
      options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
    );
    this.server.on("connection", (socket: WebSocket, request: IncomingMessage) =>
      this.handleConnection(socket, request),
    );

    if (options.tallyService) {
      options.tallyService.on("update", (sources) => {
        this.broadcastTallyUpdate(sources);
      });
    }
  }

  attach(server: HttpServer | HttpsServer): void {
    server.on("upgrade", this.handleUpgrade);
    this.startHeartbeat();
  }

  async close(): Promise<void> {
    this.closing = true;

    this.connections.stopHeartbeat();
    this.clearAllTimers();

    const closingConnections = this.connections.values();

    for (const connection of closingConnections) {
      connection.socket.close(CloseCodes.serverShutdown, "server shutdown");
    }

    await Promise.all(closingConnections.map((connection) =>
      this.cleanupConnection(connection.socket, "shutdown"),
    ));
    this.connections.clear();
    await this.outcomeQueue;

    await new Promise<void>((resolve, reject) => {
      this.server.close((error?: Error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    await this.options.mediaService?.close();
  }

  async forceMuteUser(userId: string): Promise<void> {
    await this.enqueueOutcome(() => this.coordination.admin({
      at: Date.now(),
      command: { type: "force-mute-user", targetUserId: userId },
    }));
  }

  getConnectedUserIds(): string[] {
    return this.coordination.getConnectedUserIds();
  }

  getConnectedUsersCount(): number {
    return this.getConnectedUserIds().length;
  }

  getPublicState(): StreamDeckPublicState {
    return buildStreamDeckPublicState(this.options.database, this.coordination.readProjectionSnapshot());
  }

  async disconnectAllUsers(
    reason: string = "Disconnected by server",
    detachReason: OperatorSessionDetachReason = "disconnect",
  ): Promise<void> {
    const connections = this.connections.authenticated();
    await Promise.all(connections.map((connection) =>
      this.disconnectConnection(connection, reason, detachReason),
    ));
  }

  async disconnectSession(
    sessionToken: string,
    reason: string = "Session revoked",
    detachReason: OperatorSessionDetachReason = "revoked",
  ): Promise<void> {
    const connections = this.connections.values().filter(
      (connection) => connection.sessionToken === sessionToken,
    );
    await Promise.all(connections.map((connection) =>
      this.disconnectConnection(connection, reason, detachReason),
    ));
  }

  async disconnectUser(userId: string, reason: string = "Disconnected by admin"): Promise<void> {
    const connections = this.connections.values().filter((connection) => {
      if (!connection.sessionToken) {
        return false;
      }

      return this.sessionDirectory.get(connection.sessionToken)?.userId === userId;
    });
    await Promise.all(connections.map((connection) =>
      this.disconnectConnection(connection, reason, "revoked"),
    ));
  }

  async refreshAllSessions(): Promise<void> {
    await this.enqueueOutcome(() => this.coordination.lifecycle({
      at: Date.now(),
      change: { type: "all.refresh" },
    }));
  }

  async refreshUserSessions(userId: string): Promise<void> {
    await this.enqueueOutcome(() => this.coordination.lifecycle({
      at: Date.now(),
      change: { type: "user.refresh", userId },
    }));
  }

  async startChannelRecording(channelId: string): Promise<void> {
    const recordingService = this.options.recordingService;
    if (!recordingService) return;

    const channel = this.options.database.listChannels().find((entry) => entry.id === channelId);
    if (!channel) return;

    await recordingService.startRecording(channelId, channel.name);
    this.broadcastRecordingState();
  }

  async stopChannelRecording(
    channelId: string,
  ): Promise<{ durationMs: number; filePath: string } | undefined> {
    const recordingService = this.options.recordingService;
    if (!recordingService) return undefined;

    const result = await recordingService.stopRecording(channelId);
    this.broadcastRecordingState();
    return result;
  }

  async unlatchChannel(channelId: string): Promise<void> {
    await this.enqueueOutcome(() => this.coordination.admin({
      at: Date.now(),
      command: { channelId, type: "unlatch-channel" },
    }));
  }

  broadcastRecordingState(): void {
    const recordingService = this.options.recordingService;
    const activeChannelIds = recordingService?.getActiveChannelIds() ?? [];
    const message: ServerSignalingMessage = {
      type: "recording:state",
      payload: { activeChannelIds },
    };

    for (const connection of this.connections.authenticated()) {
      this.sendMessage(connection.socket, message);
    }
  }

  broadcastTallyUpdate(sources: TallySourceState[]): void {
    const message: ServerSignalingMessage = {
      type: "tally:update",
      payload: { sources },
    };

    for (const connection of this.connections.authenticated()) {
      this.sendMessage(connection.socket, message);
    }
  }

  private applyAuditStep(step: Extract<OperatorSessionCoordinationStep, { adapter: "audit" }>): void {
    try {
      this.options.database.logEvent({
        channel_id: step.channelId,
        details: step.details,
        event_type: step.eventType,
        user_id: step.userId,
        username: step.username,
      });
    } catch {
      // never crash
    }
  }

  private applyOscStep(step: Extract<OperatorSessionCoordinationStep, { adapter: "osc" }>): void {
    try {
      const oscService = this.options.oscService;
      if (!oscService) {
        return;
      }

      switch (step.kind) {
        case "all-page-start":
          oscService.notifyAllPageStart(step.username);
          return;
        case "all-page-stop":
          oscService.notifyAllPageStop();
          return;
        case "user-online":
          oscService.notifyUserOnline(step.userId, step.username);
          return;
        case "user-offline":
          oscService.notifyUserOffline(step.userId, step.username);
          return;
        case "user-talking":
          oscService.notifyUserTalking(step.userId, step.channelId);
          return;
        case "user-stopped":
          oscService.notifyUserStopped(step.userId, step.channelIds);
          return;
      }
    } catch {
      // never crash
    }
  }

  private enqueueOutcome(
    factory: () => OperatorSessionCoordinationResult | undefined,
    authContext?: { sessionToken: string; socket: WebSocket },
  ): Promise<void> {
    const operation = this.outcomeQueue.then(async () => {
      const result = factory();

      if (!result) {
        return;
      }

      await this.applyOutcomeSteps(result, authContext);
    });

    this.outcomeQueue = operation.then(
      () => undefined,
      () => undefined,
    );

    return operation;
  }

  private async applyOutcomeSteps(
    result: OperatorSessionCoordinationResult,
    authContext?: { sessionToken: string; socket: WebSocket },
  ): Promise<void> {
    let mediaFailure: { message: string; sessionToken: string } | undefined;

    for (const step of result.steps) {
      switch (step.adapter) {
        case "transport":
          this.applyTransportStep(step, authContext);
          break;
        case "directory":
          this.applyDirectoryStep(step);
          break;
        case "media-routing": {
          const mediaResult = await this.mediaRouting.applyCoordinationStep(
            step,
            (sessionToken) => this.coordination.readMediaRoutingContext(sessionToken),
          );
          this.applyMediaRoutingResult(mediaResult);
          if (mediaResult.rejection?.code === "media-error") {
            mediaFailure = {
              message: mediaResult.rejection.message,
              sessionToken: step.sessionToken,
            };
          }
          break;
        }
        case "projection":
          this.applyProjectionStep(step);
          break;
        case "audit":
          this.applyAuditStep(step);
          break;
        case "osc":
          this.applyOscStep(step);
          break;
        case "recording":
          this.applyRecordingStep(step);
          break;
        case "timer":
          this.applyTimerStep(step);
          break;
      }
    }

    if (mediaFailure) {
      this.closeSessionForMediaFailure(mediaFailure.sessionToken, mediaFailure.message);
    }
  }

  private closeSessionForMediaFailure(sessionToken: string, message: string): void {
    for (const socket of this.findSocketsForTransport(sessionToken)) {
      socket.close(CloseCodes.mediaFailure, message.slice(0, 123));
    }
  }

  private applyDirectoryStep(step: Extract<OperatorSessionCoordinationStep, { adapter: "directory" }>): void {
    const entry = {
      channelIds: step.channelIds,
      role: step.role,
      userId: step.userId,
      username: step.username,
    };

    this.sessionDirectory.set(step.sessionToken, entry);
    this.chat.syncSession(step.sessionToken, {
      channelIds: entry.channelIds,
      userId: entry.userId,
      username: entry.username,
    });
  }

  private applyProjectionStep(step: Extract<OperatorSessionCoordinationStep, { adapter: "projection" }>): void {
    if (step.projection === "admin-dashboard") {
      this.broadcastAdminDashboard();
      return;
    }

    try {
      this.options.onStateChange?.();
    } catch {
      // never crash
    }
  }

  private applyChatResult(result: ChannelChatResult): void {
    for (const step of result.steps) {
      if (step.adapter === "audit") {
        this.applyAuditStep(step);
        continue;
      }

      this.applyTransportStep(step);
    }
  }

  private applyMediaRoutingResult(result: MediaRoutingResult): void {
    for (const step of result.steps) {
      this.applyTransportStep(step);
    }
  }

  private applyRecordingStep(step: Extract<OperatorSessionCoordinationStep, { adapter: "recording" }>): void {
    try {
      this.options.recordingService?.logTalkEvent(
        step.mode,
        step.userId,
        step.username,
        step.channelIds,
      );
    } catch {
      // never crash
    }
  }

  private applyTimerStep(step: Extract<OperatorSessionCoordinationStep, { adapter: "timer" }>): void {
    const timerMap = step.timerType === "direct-call-timeout"
      ? this.timers.directCallTimeout
      : this.timers.signalExpire;

    const existing = timerMap.get(step.key);
    if (existing) {
      clearTimeout(existing);
      timerMap.delete(step.key);
    }

    if (step.kind === "cancel") {
      return;
    }

    const timer = setTimeout(() => {
      timerMap.delete(step.key);
      void this.handleInternalLifecycle(step.timerType, step.key);
    }, step.delayMs);

    timerMap.set(step.key, timer);
  }

  private applyTransportStep(
    step: Extract<OperatorSessionCoordinationStep, { adapter: "transport" }>,
    authContext?: { sessionToken: string; socket: WebSocket },
  ): void {
    if (step.kind === "disconnect") {
      if (this.sessionDirectory.has(step.sessionToken)) {
        this.kickedSessionTokens.add(step.sessionToken);
      }
      this.chat.removeSession(step.sessionToken);
      this.sessionDirectory.delete(step.sessionToken);
      const targetSockets = this.findSocketsForTransport(step.sessionToken, authContext);
      for (const socket of targetSockets) {
        socket.close(step.code, step.reason);
      }
      return;
    }

    const targetSockets = this.findSocketsForTransport(step.sessionToken, authContext);
    for (const socket of targetSockets) {
      this.sendMessage(socket, step.message);
    }
  }

  private buildAdminDashboardSnapshot() {
    return buildAdminDashboardSnapshot(this.options.database, this.coordination.readProjectionSnapshot());
  }

  private broadcastAdminDashboard(): void {
    const message: ServerSignalingMessage = {
      type: "admin:dashboard",
      payload: this.buildAdminDashboardSnapshot(),
    };

    for (const connection of this.connections.authenticated()) {
      const role = this.sessionDirectory.get(connection.sessionToken)?.role;

      if (role !== "admin" && role !== "operator") {
        continue;
      }

      this.sendMessage(connection.socket, message);
    }
  }

  private clearAllTimers(): void {
    for (const timer of this.timers.directCallTimeout.values()) {
      clearTimeout(timer);
    }
    for (const timer of this.timers.signalExpire.values()) {
      clearTimeout(timer);
    }
    this.timers.directCallTimeout.clear();
    this.timers.signalExpire.clear();
  }

  private cleanupConnection(
    socket: WebSocket,
    detachReason?: OperatorSessionDetachReason,
  ): Promise<void> {
    const connection = this.connections.get(socket);

    if (!connection) {
      return Promise.resolve();
    }

    if (connection.cleanupPromise) {
      return connection.cleanupPromise;
    }

    connection.cleanupPromise = this.finishConnectionCleanup(
      socket,
      connection,
      detachReason ?? this.resolveDetachReason(connection),
    );
    return connection.cleanupPromise;
  }

  private resolveDetachReason(connection: ConnectionRecord): OperatorSessionDetachReason {
    if (this.closing) {
      return "shutdown";
    }

    if (connection.sessionToken && this.kickedSessionTokens.delete(connection.sessionToken)) {
      return "revoked";
    }

    return "disconnect";
  }

  private async finishConnectionCleanup(
    socket: WebSocket,
    connection: ConnectionRecord,
    detachReason: OperatorSessionDetachReason,
  ): Promise<void> {
    if (this.connections.get(socket) !== connection) {
      return;
    }

    this.connections.delete(socket);

    const sessionToken = connection.sessionToken;
    if (!sessionToken) {
      return;
    }

    if (this.findSocketBySessionToken(sessionToken)) {
      return;
    }

    this.chat.removeSession(sessionToken);
    this.sessionDirectory.delete(sessionToken);

    try {
      await this.enqueueOutcome(() => this.coordination.lifecycle({
        at: Date.now(),
        change: {
          reason: detachReason,
          sessionToken,
          type: "session.detach",
        },
      }));
    } catch (error) {
      console.error("[Operator session] Failed to clean up operator session:", error);
    }
  }

  private async disconnectConnection(
    connection: ConnectionRecord,
    reason: string,
    detachReason: OperatorSessionDetachReason,
  ): Promise<void> {
    try {
      await this.cleanupConnection(connection.socket, detachReason);
    } finally {
      if (
        connection.socket.readyState === WebSocket.OPEN ||
        connection.socket.readyState === WebSocket.CONNECTING
      ) {
        connection.socket.close(CloseCodes.forbidden, reason);
      }
    }
  }

  private findSocketBySessionToken(sessionToken: string): WebSocket | undefined {
    return this.connections.findSocketBySessionToken(sessionToken);
  }

  private findSocketsForTransport(
    sessionToken: string,
    authContext?: { sessionToken: string; socket: WebSocket },
  ): WebSocket[] {
    return this.connections.socketsForSession(sessionToken, authContext);
  }

  private handleConnection(socket: WebSocket, request?: IncomingMessage): void {
    const connection = this.connections.add(socket, parseRequestHost(request?.headers.host));

    socket.on("close", () => {
      void this.cleanupConnection(socket).catch((error) => {
        console.error("[Operator session] Failed to clean up closed socket:", error);
      });
    });
    socket.on("error", () => {
      void this.cleanupConnection(socket).catch((error) => {
        console.error("[Operator session] Failed to clean up errored socket:", error);
      });
    });
    socket.on("message", (payload: RawData) => {
      void this.handleMessage(connection, payload);
    });
    socket.on("pong", () => {
      connection.isAlive = true;
    });
  }

  private async handleInternalLifecycle(timerType: "direct-call-timeout" | "signal-expire", key: string): Promise<void> {
    const change: OperatorSessionLifecycleChange = timerType === "direct-call-timeout"
      ? { callId: key, type: "direct-call.timeout" }
      : { signalId: key, type: "signal.expire" };

    await this.enqueueOutcome(() => this.coordination.lifecycle({
      at: Date.now(),
      change,
    }));
  }

  private async handleMediaRequest(
    sessionToken: string,
    parsed: MediaRequestMessage,
  ): Promise<void> {
    this.applyMediaRoutingResult(await this.mediaRouting.handleRequest(
      {
        message: parsed,
        sessionToken,
      },
      (currentSessionToken) => this.coordination.readMediaRoutingContext(currentSessionToken),
    ));
  }

  private async handleMessage(connection: ConnectionRecord, payload: RawData): Promise<void> {
    try {
      const parsed = parseClientSignalingMessage(JSON.parse(payload.toString()));

      if (parsed.type === "session:authenticate") {
        await this.handleSessionAuthenticate(connection, parsed.payload.sessionToken);
        return;
      }

      if (!connection.sessionToken) {
        this.sendSignalError(connection.socket, "unauthorized", "Authenticate the realtime session first.");
        return;
      }

      if (parsed.type === "chat:send") {
        this.handleChatSend(connection.sessionToken, parsed.payload);
        return;
      }

      if (this.isMediaRequestMessage(parsed)) {
        await this.handleMediaRequest(connection.sessionToken, parsed);
        return;
      }

      const command = toCoordinationCommand(parsed);

      if (!command) {
        this.sendSignalError(connection.socket, "invalid-message", "That realtime message is not supported.");
        return;
      }

      const sessionToken = connection.sessionToken;
      await this.enqueueOutcome(() => this.coordination.command({
        actorSessionToken: sessionToken,
        at: Date.now(),
        command,
      }));
    } catch (error) {
      this.sendSignalError(
        connection.socket,
        "invalid-message",
        error instanceof Error ? error.message : "Unable to parse realtime message.",
      );
    }
  }

  private handleChatSend(
    sessionToken: string,
    payload: { channelId: string; text: string },
  ): void {
    this.applyChatResult(
      this.chat.command({
        actorSessionToken: sessionToken,
        at: Date.now(),
        command: {
          type: "chat.send",
          channelId: payload.channelId,
          text: payload.text,
        },
      }),
    );
  }

  private readonly handleUpgrade = (
    request: IncomingMessage,
    socket: Socket,
    head: Buffer,
  ): void => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

    if (requestUrl.pathname !== this.path) {
      socket.destroy();
      return;
    }

    this.server.handleUpgrade(request, socket, head, (websocket: WebSocket) => {
      this.server.emit("connection", websocket, request);
    });
  };

  private async handleSessionAuthenticate(connection: ConnectionRecord, sessionToken: string): Promise<void> {
    if (connection.authenticationAttempted) {
      await connection.authenticationPromise;
      return;
    }

    connection.authenticationAttempted = true;
    const authenticationPromise = this.authenticateConnection(connection, sessionToken);
    connection.authenticationPromise = authenticationPromise;

    try {
      await authenticationPromise;
    } finally {
      if (connection.authenticationPromise === authenticationPromise) {
        connection.authenticationPromise = undefined;
      }
    }
  }

  private async authenticateConnection(connection: ConnectionRecord, sessionToken: string): Promise<void> {
    if (!this.isConnectionActive(connection)) {
      return;
    }

    const connectHost = isUsableMediaHost(connection.requestHost)
      ? await resolveMediaHost(connection.requestHost)
      : undefined;

    if (!this.isConnectionActive(connection)) {
      return;
    }

    await this.enqueueOutcome(() => {
      if (!this.isConnectionActive(connection)) {
        return undefined;
      }

      const result = this.coordination.lifecycle({
        at: Date.now(),
        change: {
          connectHost,
          sessionToken,
          type: "session.attach",
        },
      });

      if (result.decision !== "rejected") {
        connection.sessionToken = sessionToken;
      }

      return result;
    }, {
      sessionToken,
      socket: connection.socket,
    });

    if (connection.sessionToken !== sessionToken || !this.isConnectionActive(connection)) {
      return;
    }

    this.sendChatHistory(sessionToken, connection.socket);
    this.sendBootstrapState(sessionToken, connection.socket);
  }

  private isConnectionActive(connection: ConnectionRecord): boolean {
    return (
      !this.closing &&
      this.connections.get(connection.socket) === connection &&
      (connection.socket.readyState === WebSocket.OPEN || connection.socket.readyState === WebSocket.CONNECTING)
    );
  }

  private isMediaRequestMessage(message: ClientSignalingMessage): message is MediaRequestMessage {
    return (
      message.type === "media:capabilities:get" ||
      message.type === "media:transport:create" ||
      message.type === "media:transport:connect" ||
      message.type === "media:producer:create" ||
      message.type === "media:producer:close" ||
      message.type === "media:consumer:resume"
    );
  }

  private sendBootstrapState(sessionToken: string, socket: WebSocket): void {
    const tallySources = this.options.tallyService?.getSources() ?? [];
    if (tallySources.length > 0) {
      this.sendMessage(socket, {
        type: "tally:update",
        payload: { sources: tallySources },
      });
    }

    const recordingActiveIds = this.options.recordingService?.getActiveChannelIds() ?? [];
    if (recordingActiveIds.length > 0) {
      this.sendMessage(socket, {
        type: "recording:state",
        payload: { activeChannelIds: recordingActiveIds },
      });
    }

    const projection = this.coordination.readProjectionSnapshot();
    if (projection.allPage) {
      this.sendMessage(socket, {
        type: "allpage:active",
        payload: {
          userId: projection.allPage.userId,
          username: projection.allPage.username,
        },
      });
    }
  }

  private sendChatHistory(sessionToken: string, socket: WebSocket): void {
    for (const step of this.chat.bootstrap(sessionToken)) {
      if (step.sessionToken !== sessionToken) {
        continue;
      }

      this.sendMessage(socket, step.message);
    }
  }

  private sendMessage(socket: WebSocket, message: ServerSignalingMessage): void {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify(message));
  }

  private sendSignalError(target: WebSocket, code: RejectionCode, message: string, requestId?: string): void {
    this.sendMessage(target, buildSignalError(code, message, requestId));
  }

  private startHeartbeat(): void {
    this.connections.startHeartbeat();
  }
}
