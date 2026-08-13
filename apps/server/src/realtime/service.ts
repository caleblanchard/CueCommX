import { lookup } from "node:dns/promises";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import { isIP } from "node:net";
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
import { MediaRoutingModule, type MediaRoutingResult } from "./media-routing.js";
import {
  OperatorSessionCoordination,
  type OperatorSessionAdminCommand,
  type OperatorSessionCommand,
  type OperatorSessionCoordinationResult,
  type OperatorSessionCoordinationStep,
  type OperatorSessionDetachReason,
  type OperatorSessionLifecycleChange,
} from "./operator-session-coordination.js";
import {
  buildAdminDashboardSnapshot,
  buildStreamDeckPublicState,
  type StreamDeckPublicState,
} from "./projections.js";

interface ConnectionRecord {
  authenticationAttempted: boolean;
  authenticationPromise?: Promise<void>;
  cleanupPromise?: Promise<void>;
  isAlive: boolean;
  requestHost?: string;
  sessionToken?: string;
  socket: WebSocket;
}

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

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_PATH = "/ws";

function parseRequestHost(headersHost?: string): string | undefined {
  if (!headersHost) {
    return undefined;
  }

  try {
    return new URL(`http://${headersHost}`).hostname;
  } catch {
    return undefined;
  }
}

function isUsableMediaHost(host?: string): host is string {
  if (!host) {
    return false;
  }

  if (host === "localhost" || host === "::1" || host.startsWith("127.")) {
    return false;
  }

  if (host === "0.0.0.0" || host === "::") {
    return false;
  }

  return true;
}

async function resolveMediaHost(host: string): Promise<string> {
  if (isIP(host) > 0) {
    return host;
  }

  try {
    const result = await lookup(host, { family: 4 });
    return result.address;
  } catch {
    return host;
  }
}

export class RealtimeService {
  private readonly chat = new ChannelChatModule();

  private closing = false;

  private readonly connections = new Map<WebSocket, ConnectionRecord>();

  private readonly coordination: OperatorSessionCoordination;

  private readonly mediaRouting: MediaRoutingModule;

  private outcomeQueue: Promise<void> = Promise.resolve();

  private readonly sessionDirectory = new Map<string, SessionDirectoryEntry>();

  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;

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

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    this.clearAllTimers();

    const closingConnections = [...this.connections.values()];

    for (const connection of closingConnections) {
      connection.socket.close(1001, "server shutdown");
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
    const connections = [...this.connections.values()].filter((connection) => connection.sessionToken);
    await Promise.all(connections.map((connection) =>
      this.disconnectConnection(connection, reason, detachReason),
    ));
  }

  async disconnectSession(
    sessionToken: string,
    reason: string = "Session revoked",
    detachReason: OperatorSessionDetachReason = "revoked",
  ): Promise<void> {
    const connections = [...this.connections.values()].filter(
      (connection) => connection.sessionToken === sessionToken,
    );
    await Promise.all(connections.map((connection) =>
      this.disconnectConnection(connection, reason, detachReason),
    ));
  }

  async disconnectUser(userId: string, reason: string = "Disconnected by admin"): Promise<void> {
    const connections = [...this.connections.values()].filter((connection) => {
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

    for (const connection of this.connections.values()) {
      if (!connection.sessionToken) {
        continue;
      }

      this.sendMessage(connection.socket, message);
    }
  }

  broadcastTallyUpdate(sources: TallySourceState[]): void {
    const message: ServerSignalingMessage = {
      type: "tally:update",
      payload: { sources },
    };

    for (const connection of this.connections.values()) {
      if (!connection.sessionToken) {
        continue;
      }

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
    factory: () => OperatorSessionCoordinationResult,
    authContext?: { sessionToken: string; socket: WebSocket },
  ): Promise<void> {
    const operation = this.outcomeQueue.then(async () => {
      const result = factory();
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
      socket.close(1011, message.slice(0, 123));
    }
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

    if (step.message.type === "session:ready") {
      this.updateSessionDirectory(step.sessionToken, step.message);
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

    for (const connection of this.connections.values()) {
      if (!connection.sessionToken) {
        continue;
      }

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
        connection.socket.close(4403, reason);
      }
    }
  }

  private findSocketBySessionToken(sessionToken: string): WebSocket | undefined {
    for (const connection of this.connections.values()) {
      if (connection.sessionToken === sessionToken) {
        return connection.socket;
      }
    }

    return undefined;
  }

  private findSocketsForTransport(
    sessionToken: string,
    authContext?: { sessionToken: string; socket: WebSocket },
  ): WebSocket[] {
    const sockets = [...this.connections.values()]
      .filter((connection) => connection.sessionToken === sessionToken)
      .map((connection) => connection.socket);

    if (sockets.length > 0) {
      return sockets;
    }

    if (authContext?.sessionToken === sessionToken) {
      return [authContext.socket];
    }

    return [];
  }

  private handleConnection(socket: WebSocket, request?: IncomingMessage): void {
    const connection: ConnectionRecord = {
      authenticationAttempted: false,
      isAlive: true,
      requestHost: parseRequestHost(request?.headers.host),
      socket,
    };

    this.connections.set(socket, connection);

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

      const command = this.toCoordinationCommand(parsed);

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
        return {
          decision: "noop",
          revision: 0,
          steps: [],
        } satisfies OperatorSessionCoordinationResult;
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

  private sendSignalError(target: WebSocket, code: string, message: string, requestId?: string): void {
    this.sendMessage(target, {
      type: "signal:error",
      payload: {
        code,
        message,
        ...(requestId ? { requestId } : {}),
      },
    });
  }

  private updateSessionDirectory(
    sessionToken: string,
    message: Extract<ServerSignalingMessage, { type: "session:ready" }>,
  ): void {
    const entry = {
      channelIds: message.payload.channels.map((channel) => channel.id),
      role: message.payload.user.role,
      userId: message.payload.user.id,
      username: message.payload.user.username,
    };

    this.sessionDirectory.set(sessionToken, entry);
    this.chat.syncSession(sessionToken, {
      channelIds: entry.channelIds,
      userId: entry.userId,
      username: entry.username,
    });
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      for (const connection of this.connections.values()) {
        if (!connection.isAlive) {
          connection.socket.terminate();
          continue;
        }

        connection.isAlive = false;
        connection.socket.ping();
      }
    }, this.options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
  }

  private toCoordinationCommand(message: ClientSignalingMessage): OperatorSessionCommand | undefined {
    switch (message.type) {
      case "listen:toggle":
        return {
          channelId: message.payload.channelId,
          listening: message.payload.listening,
          type: "listen.set",
        };
      case "talk:start":
        return {
          channelIds: [...message.payload.channelIds],
          type: "talk.start",
        };
      case "talk:stop":
        return {
          channelIds: [...message.payload.channelIds],
          type: "talk.stop",
        };
      case "quality:report":
        return {
          quality: message.payload,
          type: "quality.report",
        };
      case "preflight:result":
        return {
          status: message.payload.status,
          type: "preflight.report",
        };
      case "allpage:start":
        return { type: "all-page.start" };
      case "allpage:stop":
        return { type: "all-page.stop" };
      case "signal:send":
        return {
          signalType: message.payload.signalType,
          targetChannelId: message.payload.targetChannelId,
          targetUserId: message.payload.targetUserId,
          type: "signal.send",
        };
      case "signal:ack":
        return {
          signalId: message.payload.signalId,
          type: "signal.ack",
        };
      case "direct:request":
        return {
          targetUserId: message.payload.targetUserId,
          type: "direct-call.request",
        };
      case "direct:accept":
        return {
          callId: message.payload.callId,
          type: "direct-call.accept",
        };
      case "direct:reject":
        return {
          callId: message.payload.callId,
          type: "direct-call.reject",
        };
      case "direct:end":
        return {
          callId: message.payload.callId,
          type: "direct-call.end",
        };
      case "ifb:start":
        return {
          targetUserId: message.payload.targetUserId,
          type: "ifb.start",
        };
      case "ifb:stop":
        return { type: "ifb.stop" };
      default:
        return undefined;
    }
  }
}
