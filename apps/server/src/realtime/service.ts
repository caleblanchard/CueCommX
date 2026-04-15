import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import { isIP } from "node:net";
import type { Socket } from "node:net";

import {
  type AdminDashboardSnapshot,
  PROTOCOL_VERSION,
  parseClientSignalingMessage,
  type ClientSignalingMessage,
  type ChannelInfo,
  type ChannelPermission,
  type OperatorState,
  type ServerSignalingMessage,
  type UserInfo,
} from "@cuecommx/protocol";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import { SessionStore } from "../auth/session-store.js";
import { DatabaseService } from "../db/database.js";
import type { MediaRequestMessage, MediaSessionContext, RealtimeMediaService } from "../media/service.js";

interface AuthenticatedConnection {
  channels: ChannelInfo[];
  connectHost?: string;
  sessionToken: string;
  state: OperatorState;
  user: UserInfo;
}

interface ConnectionRecord {
  authenticated?: AuthenticatedConnection;
  isAlive: boolean;
  requestHost?: string;
  socket: WebSocket;
}

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

  return isIP(host) > 0;
}

export interface RealtimeServiceOptions {
  database: DatabaseService;
  heartbeatIntervalMs?: number;
  maxUsers?: number;
  mediaService?: RealtimeMediaService;
  path?: string;
  sessionStore: SessionStore;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_PATH = "/ws";

export class RealtimeService {
  private closing = false;

  private readonly connections = new Map<WebSocket, ConnectionRecord>();

  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  private readonly operatorStates = new Map<string, OperatorState>();

  private readonly path: string;

  private readonly server = new WebSocketServer({ noServer: true });

  constructor(private readonly options: RealtimeServiceOptions) {
    this.path = options.path ?? DEFAULT_PATH;
    this.server.on("connection", (socket: WebSocket, request: IncomingMessage) =>
      this.handleConnection(socket, request),
    );
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

    const closingConnections = [...this.connections.values()];

    this.connections.clear();
    this.operatorStates.clear();

    for (const connection of closingConnections) {
      connection.socket.close(1001, "server shutdown");
    }

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

  async refreshAllSessions(): Promise<void> {
    for (const connection of this.connections.values()) {
      await this.refreshAuthenticatedConnection(connection);
    }

    this.broadcastAdminDashboard();
  }

  async refreshUserSessions(userId: string): Promise<void> {
    for (const connection of this.connections.values()) {
      if (connection.authenticated?.user.id !== userId) {
        continue;
      }

      await this.refreshAuthenticatedConnection(connection);
    }

    this.broadcastAdminDashboard();
  }

  disconnectUser(userId: string, reason: string = "Disconnected by admin"): void {
    for (const connection of this.connections.values()) {
      if (connection.authenticated?.user.id !== userId) {
        continue;
      }

      connection.socket.close(4403, reason);
    }
  }

  disconnectAllUsers(reason: string = "Disconnected by server"): void {
    for (const connection of this.connections.values()) {
      if (!connection.authenticated) {
        continue;
      }

      connection.socket.close(4403, reason);
    }
  }

  async forceMuteUser(userId: string): Promise<void> {
    const mutedConnections: AuthenticatedConnection[] = [];
    let didMute = false;

    for (const connection of this.connections.values()) {
      if (connection.authenticated?.user.id !== userId) {
        continue;
      }

      if (connection.authenticated.state.talkChannelIds.length === 0) {
        continue;
      }

      connection.authenticated.state = {
        ...connection.authenticated.state,
        talkChannelIds: [],
        talking: false,
      };
      this.operatorStates.set(connection.authenticated.sessionToken, connection.authenticated.state);
      this.sendOperatorState(connection.authenticated);
      mutedConnections.push(connection.authenticated);
      didMute = true;
    }

    if (didMute) {
      for (const mutedConnection of mutedConnections) {
        await this.syncMediaState(mutedConnection);
      }

      this.broadcastAdminDashboard();
    }
  }

  getConnectedUserIds(): string[] {
    const userIds = new Set<string>();

    for (const connection of this.connections.values()) {
      if (!connection.authenticated) {
        continue;
      }

      userIds.add(connection.authenticated.user.id);
    }

    return [...userIds].sort((left, right) => left.localeCompare(right));
  }

  getConnectedUsersCount(): number {
    return this.getConnectedUserIds().length;
  }

  private getAuthenticatedSessionCount(): number {
    let count = 0;

    for (const connection of this.connections.values()) {
      if (connection.authenticated) {
        count += 1;
      }
    }

    return count;
  }

  private buildOperatorState(user: UserInfo, sessionToken: string): OperatorState {
    const storedState = this.operatorStates.get(sessionToken);
    const permissions = new Map(
      user.channelPermissions.map((permission) => [permission.channelId, permission]),
    );
    const fallbackState: OperatorState =
      storedState ?? {
        talkChannelIds: [],
        listenChannelIds: user.channelPermissions
          .filter((permission) => permission.canListen)
          .map((permission) => permission.channelId)
          .sort((left, right) => left.localeCompare(right)),
        talking: false,
      };
    const talkChannelIds = fallbackState.talkChannelIds
      .filter((channelId) => permissions.get(channelId)?.canTalk)
      .sort((left, right) => left.localeCompare(right));
    const listenChannelIds = fallbackState.listenChannelIds
      .filter((channelId) => permissions.get(channelId)?.canListen)
      .sort((left, right) => left.localeCompare(right));

    return {
      talkChannelIds,
      listenChannelIds,
      talking: talkChannelIds.length > 0,
    };
  }

  private async applyListenToggle(
    connection: AuthenticatedConnection,
    permission: ChannelPermission | undefined,
    channelId: string,
    listening: boolean,
  ): Promise<void> {
    if (!permission) {
      this.sendSignalError(connection, "forbidden", "That channel is not assigned to this operator.");
      return;
    }

    if (listening && !permission.canListen) {
      this.sendSignalError(connection, "forbidden", "This operator cannot listen to that channel.");
      return;
    }

    const nextListenChannelIds = listening
      ? [...new Set([...connection.state.listenChannelIds, channelId])].sort((left, right) =>
          left.localeCompare(right),
        )
      : connection.state.listenChannelIds.filter((entry) => entry !== channelId);

    connection.state = {
      ...connection.state,
      listenChannelIds: nextListenChannelIds,
    };
    this.operatorStates.set(connection.sessionToken, connection.state);
    this.sendOperatorState(connection);
    await this.syncMediaState(connection);
    this.broadcastAdminDashboard();
  }

  private async applyTalkChange(
    connection: AuthenticatedConnection,
    channelIds: string[],
    mode: "start" | "stop",
  ): Promise<void> {
    const permissions = new Map(
      connection.user.channelPermissions.map((permission) => [permission.channelId, permission]),
    );

    for (const channelId of channelIds) {
      const permission = permissions.get(channelId);

      if (!permission || !permission.canTalk) {
        this.sendSignalError(connection, "forbidden", "This operator cannot talk on that channel.");
        return;
      }
    }

    const nextTalkChannelIds =
      mode === "start"
        ? [...new Set([...connection.state.talkChannelIds, ...channelIds])].sort((left, right) =>
            left.localeCompare(right),
          )
        : connection.state.talkChannelIds.filter((entry) => !channelIds.includes(entry));

    connection.state = {
      ...connection.state,
      talkChannelIds: nextTalkChannelIds,
      talking: nextTalkChannelIds.length > 0,
    };
    this.operatorStates.set(connection.sessionToken, connection.state);
    this.sendOperatorState(connection);
    await this.syncMediaState(connection);
    this.broadcastAdminDashboard();
  }

  private async authenticateConnection(
    connection: ConnectionRecord,
    sessionToken: string,
  ): Promise<AuthenticatedConnection | undefined> {
    const session = this.options.sessionStore.get(sessionToken);

    if (!session) {
      this.sendSignalError(connection.socket, "unauthorized", "Session token is invalid or expired.");
      connection.socket.close(4401, "Unauthorized");
      return undefined;
    }

    const user = this.options.database.getUser(session.userId);

    if (!user) {
      this.sendSignalError(connection.socket, "unauthorized", "Session user was not found.");
      connection.socket.close(4401, "Unauthorized");
      return undefined;
    }

    const sessionAlreadyConnected = [...this.connections.values()].some(
      (record) =>
        record !== connection &&
        record.authenticated?.sessionToken === sessionToken,
    );
    const maxUsers = this.options.maxUsers;

    if (
      maxUsers !== undefined &&
      maxUsers > 0 &&
      !sessionAlreadyConnected &&
      this.getAuthenticatedSessionCount() >= maxUsers
    ) {
      this.sendSignalError(
        connection.socket,
        "capacity-reached",
        `CueCommX is at capacity (${maxUsers} active session${maxUsers === 1 ? "" : "s"}).`,
      );
      connection.socket.close(4429, "Server at capacity");
      return undefined;
    }

    const channels = this.options.database.listAssignedChannels(user.id);
    const nextState = this.buildOperatorState(user, sessionToken);

    const authenticated: AuthenticatedConnection = {
      channels,
      connectHost: isUsableMediaHost(connection.requestHost) ? connection.requestHost : undefined,
      sessionToken,
      state: nextState,
      user,
    };

    connection.authenticated = authenticated;
    this.operatorStates.set(sessionToken, nextState);

    this.sendMessage(connection.socket, {
      type: "session:ready",
      payload: {
        protocolVersion: PROTOCOL_VERSION,
        connectedUsers: this.getConnectedUsersCount(),
        user,
        channels,
        operatorState: nextState,
      },
    });

    await this.dispatchMediaMessages(
      (await this.options.mediaService?.registerSession(
        this.buildMediaSessionContext(authenticated),
      )) ?? [],
    );
    this.broadcastPresence();

    return authenticated;
  }

  private broadcastPresence(): void {
    const message: ServerSignalingMessage = {
      type: "presence:update",
      payload: {
        connectedUsers: this.getConnectedUsersCount(),
      },
    };

    for (const connection of this.connections.values()) {
      if (!connection.authenticated) {
        continue;
      }

      this.sendMessage(connection.socket, message);
    }

    this.broadcastAdminDashboard();
  }

  private async cleanupConnection(socket: WebSocket): Promise<void> {
    const connection = this.connections.get(socket);

    if (!connection) {
      return;
    }

    if (this.closing) {
      this.connections.delete(socket);
      return;
    }

    if (connection.authenticated) {
      connection.authenticated.state = {
        ...connection.authenticated.state,
        talkChannelIds: [],
        talking: false,
      };
      this.operatorStates.set(connection.authenticated.sessionToken, connection.authenticated.state);
    }

    this.connections.delete(socket);
    await this.dispatchMediaMessages(
      connection.authenticated
        ? ((await this.options.mediaService?.unregisterSession(connection.authenticated.sessionToken)) ?? [])
        : [],
    );
    this.broadcastPresence();
  }

  private async refreshAuthenticatedConnection(connection: ConnectionRecord): Promise<void> {
    if (!connection.authenticated) {
      return;
    }

    const user = this.options.database.getUser(connection.authenticated.user.id);

    if (!user) {
      connection.socket.close(4404, "Session user was removed.");
      return;
    }

    const channels = this.options.database.listAssignedChannels(user.id);
    const nextState = this.buildOperatorState(user, connection.authenticated.sessionToken);

    connection.authenticated.user = user;
    connection.authenticated.channels = channels;
    connection.authenticated.state = nextState;
    this.operatorStates.set(connection.authenticated.sessionToken, nextState);

    this.sendMessage(connection.socket, {
      type: "session:ready",
      payload: {
        protocolVersion: PROTOCOL_VERSION,
        connectedUsers: this.getConnectedUsersCount(),
        user,
        channels,
        operatorState: nextState,
      },
    });

    await this.dispatchMediaMessages(
      (await this.options.mediaService?.refreshSession(
        this.buildMediaSessionContext(connection.authenticated),
      )) ?? [],
    );
  }

  private buildAdminDashboardSnapshot(): AdminDashboardSnapshot {
    const talkChannelsByUser = new Map<string, Set<string>>();
    const onlineUserIds = new Set<string>();

    for (const connection of this.connections.values()) {
      if (!connection.authenticated) {
        continue;
      }

      const userId = connection.authenticated.user.id;
      const talkChannels = talkChannelsByUser.get(userId) ?? new Set<string>();

      onlineUserIds.add(userId);

      for (const channelId of connection.authenticated.state.talkChannelIds) {
        talkChannels.add(channelId);
      }

      talkChannelsByUser.set(userId, talkChannels);
    }

    return {
      channels: this.options.database.listChannels(),
      users: this.options.database.listUsers().map((user) => {
        const activeTalkChannelIds = [...(talkChannelsByUser.get(user.id) ?? new Set<string>())].sort(
          (left, right) => left.localeCompare(right),
        );

        return {
          ...user,
          online: onlineUserIds.has(user.id),
          talking: activeTalkChannelIds.length > 0,
          activeTalkChannelIds,
        };
      }),
    };
  }

  private broadcastAdminDashboard(): void {
    const message: ServerSignalingMessage = {
      type: "admin:dashboard",
      payload: this.buildAdminDashboardSnapshot(),
    };

    for (const connection of this.connections.values()) {
      if (connection.authenticated?.user.role !== "admin") {
        continue;
      }

      this.sendMessage(connection.socket, message);
    }
  }

  private handleConnection(socket: WebSocket, request?: IncomingMessage): void {
    const connection: ConnectionRecord = {
      isAlive: true,
      requestHost: parseRequestHost(request?.headers.host),
      socket,
    };

    this.connections.set(socket, connection);

    socket.on("close", () => {
      void this.cleanupConnection(socket);
    });
    socket.on("error", () => {
      void this.cleanupConnection(socket);
    });
    socket.on("message", (payload: RawData) => {
      void this.handleMessage(connection, payload);
    });
    socket.on("pong", () => {
      connection.isAlive = true;
    });
  }

  private async handleMessage(connection: ConnectionRecord, payload: RawData): Promise<void> {
    try {
      const parsed = parseClientSignalingMessage(JSON.parse(payload.toString()));

      if (parsed.type === "session:authenticate") {
        await this.authenticateConnection(connection, parsed.payload.sessionToken);
        return;
      }

      if (!connection.authenticated) {
        this.sendSignalError(connection.socket, "unauthorized", "Authenticate the realtime session first.");
        return;
      }

      if (parsed.type === "listen:toggle") {
        const permission = connection.authenticated.user.channelPermissions.find(
          (entry) => entry.channelId === parsed.payload.channelId,
        );

        await this.applyListenToggle(
          connection.authenticated,
          permission,
          parsed.payload.channelId,
          parsed.payload.listening,
        );
        return;
      }

      if (parsed.type === "talk:start") {
        await this.applyTalkChange(connection.authenticated, parsed.payload.channelIds, "start");
        return;
      }

      if (parsed.type === "talk:stop") {
        await this.applyTalkChange(connection.authenticated, parsed.payload.channelIds, "stop");
        return;
      }

      if (this.isMediaRequestMessage(parsed)) {
        await this.dispatchMediaMessages(
          (await this.options.mediaService?.handleRequest(
            this.buildMediaSessionContext(connection.authenticated),
            parsed,
          )) ?? [],
        );
        return;
      }

      this.sendSignalError(connection.socket, "invalid-message", "That realtime message is not supported.");
    } catch (error) {
      this.sendSignalError(
        connection.socket,
        "invalid-message",
        error instanceof Error ? error.message : "Unable to parse realtime message.",
      );
    }
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

  private sendMessage(socket: WebSocket, message: ServerSignalingMessage): void {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify(message));
  }

  private sendOperatorState(connection: AuthenticatedConnection): void {
    this.sendMessage(
      this.findSocket(connection),
      {
        type: "operator-state",
        payload: connection.state,
      },
    );
  }

  private sendSignalError(target: AuthenticatedConnection | WebSocket, code: string, message: string): void {
    const socket = target instanceof WebSocket ? target : this.findSocket(target);

    this.sendMessage(socket, {
      type: "signal:error",
      payload: {
        code,
        message,
      },
    });
  }

  private buildMediaSessionContext(connection: AuthenticatedConnection): MediaSessionContext {
    return {
      channels: connection.channels,
      connectHost: connection.connectHost,
      sessionToken: connection.sessionToken,
      state: connection.state,
      user: connection.user,
    };
  }

  private async dispatchMediaMessages(messages: readonly { sessionToken: string; message: ServerSignalingMessage }[]): Promise<void> {
    for (const entry of messages) {
      const socket = this.findSocketBySessionToken(entry.sessionToken);

      if (!socket) {
        continue;
      }

      this.sendMessage(socket, entry.message);
    }
  }

  private findSocket(connection: AuthenticatedConnection): WebSocket {
    for (const record of this.connections.values()) {
      if (record.authenticated === connection) {
        return record.socket;
      }
    }

    throw new Error(`Realtime socket for ${connection.user.id} was not found.`);
  }

  private findSocketBySessionToken(sessionToken: string): WebSocket | undefined {
    for (const record of this.connections.values()) {
      if (record.authenticated?.sessionToken === sessionToken) {
        return record.socket;
      }
    }

    return undefined;
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

  private async syncMediaState(connection: AuthenticatedConnection): Promise<void> {
    await this.dispatchMediaMessages(
      (await this.options.mediaService?.updateOperatorState(
        this.buildMediaSessionContext(connection),
      )) ?? [],
    );
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
}
