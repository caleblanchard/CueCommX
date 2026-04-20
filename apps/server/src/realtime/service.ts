import { lookup } from "node:dns/promises";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import { isIP } from "node:net";
import type { Socket } from "node:net";

import {
  type AdminDashboardSnapshot,
  type CallSignalType,
  type ConnectionQuality,
  type PreflightStatus,
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
  connectionQuality?: ConnectionQuality;
  preflightStatus?: PreflightStatus;
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

interface AllPageState {
  sessionToken: string;
  userId: string;
  username: string;
  previousTalkStates: Map<string, string[]>;
}

interface ActiveSignal {
  fromUserId: string;
  fromUsername: string;
  signalId: string;
  signalType: CallSignalType;
  targetChannelId?: string;
  targetUserId?: string;
  timer: ReturnType<typeof setTimeout>;
}

interface DirectCall {
  callId: string;
  initiatorSessionToken: string;
  initiatorUserId: string;
  initiatorUsername: string;
  targetSessionToken?: string;
  targetUserId: string;
  targetUsername: string;
  state: "ringing" | "active";
  ringTimeout: ReturnType<typeof setTimeout>;
}

interface IFBState {
  directorSessionToken: string;
  directorUserId: string;
  directorUsername: string;
  targetSessionToken: string;
  targetUserId: string;
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

  private allPageState: AllPageState | undefined;

  private readonly activeSignals = new Map<string, ActiveSignal>();

  private readonly directCalls = new Map<string, DirectCall>();

  private directCallSequence = 0;

  private ifbState: IFBState | undefined;

  private signalSequence = 0;

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
    this.allPageState = undefined;
    this.ifbState = undefined;

    for (const signal of this.activeSignals.values()) {
      clearTimeout(signal.timer);
    }

    this.activeSignals.clear();

    for (const call of this.directCalls.values()) {
      clearTimeout(call.ringTimeout);
    }

    this.directCalls.clear();

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
      this.sendMessage(connection.socket, {
        type: "force-muted",
        payload: { reason: "user" },
      });
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

  async unlatchChannel(channelId: string): Promise<void> {
    const unlatchedConnections: AuthenticatedConnection[] = [];

    for (const connection of this.connections.values()) {
      if (!connection.authenticated) {
        continue;
      }

      const { state } = connection.authenticated;

      if (!state.talkChannelIds.includes(channelId)) {
        continue;
      }

      const updatedTalkChannelIds = state.talkChannelIds.filter((id) => id !== channelId);

      connection.authenticated.state = {
        ...state,
        talkChannelIds: updatedTalkChannelIds,
        talking: updatedTalkChannelIds.length > 0 && state.talking,
      };
      this.operatorStates.set(connection.authenticated.sessionToken, connection.authenticated.state);
      this.sendOperatorState(connection.authenticated);
      this.sendMessage(connection.socket, {
        type: "force-muted",
        payload: { reason: "channel", channelId },
      });
      unlatchedConnections.push(connection.authenticated);
    }

    if (unlatchedConnections.length > 0) {
      for (const unlatchedConnection of unlatchedConnections) {
        await this.syncMediaState(unlatchedConnection);
      }

      this.broadcastAdminDashboard();
    }
  }

  // --- All-Page ---

  private async handleAllPageStart(connection: AuthenticatedConnection): Promise<void> {
    const role = connection.user.role;

    if (role !== "admin" && role !== "operator") {
      this.sendSignalError(connection, "forbidden", "Only admins and operators can start All-Page.");
      return;
    }

    if (this.allPageState) {
      this.sendSignalError(connection, "conflict", "An All-Page broadcast is already active.");
      return;
    }

    // Save current talk states and force-stop all other talkers
    const previousTalkStates = new Map<string, string[]>();

    for (const record of this.connections.values()) {
      if (!record.authenticated) {
        continue;
      }

      if (record.authenticated.sessionToken === connection.sessionToken) {
        continue;
      }

      if (record.authenticated.state.talkChannelIds.length > 0) {
        previousTalkStates.set(
          record.authenticated.sessionToken,
          [...record.authenticated.state.talkChannelIds],
        );
        record.authenticated.state = {
          ...record.authenticated.state,
          talkChannelIds: [],
          talking: false,
        };
        this.operatorStates.set(record.authenticated.sessionToken, record.authenticated.state);
        this.sendOperatorState(record.authenticated);
        await this.syncMediaState(record.authenticated);
      }
    }

    this.allPageState = {
      sessionToken: connection.sessionToken,
      userId: connection.user.id,
      username: connection.user.username,
      previousTalkStates,
    };

    try { this.options.database.logEvent({ event_type: "allpage:start", user_id: connection.user.id, username: connection.user.username }); } catch { /* never crash */ }

    // Start pager talking on all channels they have talk permission for
    const allTalkChannelIds = connection.user.channelPermissions
      .filter((p) => p.canTalk)
      .map((p) => p.channelId)
      .sort((a, b) => a.localeCompare(b));

    if (allTalkChannelIds.length > 0) {
      connection.state = {
        ...connection.state,
        talkChannelIds: allTalkChannelIds,
        talking: true,
      };
      this.operatorStates.set(connection.sessionToken, connection.state);
      this.sendOperatorState(connection);
      await this.syncMediaState(connection);
    }

    // Temporarily add all channels as listen channels for all users during allpage
    for (const record of this.connections.values()) {
      if (!record.authenticated) {
        continue;
      }

      if (record.authenticated.sessionToken === connection.sessionToken) {
        continue;
      }

      const allListenChannelIds = record.authenticated.user.channelPermissions
        .filter((p) => p.canListen)
        .map((p) => p.channelId);
      const merged = [...new Set([...record.authenticated.state.listenChannelIds, ...allListenChannelIds])]
        .sort((a, b) => a.localeCompare(b));

      if (merged.length !== record.authenticated.state.listenChannelIds.length) {
        record.authenticated.state = {
          ...record.authenticated.state,
          listenChannelIds: merged,
        };
        this.operatorStates.set(record.authenticated.sessionToken, record.authenticated.state);
        await this.syncMediaState(record.authenticated);
      }
    }

    // Broadcast allpage:active to all clients
    const activeMessage: ServerSignalingMessage = {
      type: "allpage:active",
      payload: {
        userId: connection.user.id,
        username: connection.user.username,
      },
    };

    for (const record of this.connections.values()) {
      if (record.authenticated) {
        this.sendMessage(record.socket, activeMessage);
      }
    }

    this.broadcastAdminDashboard();
  }

  private async handleAllPageStop(connection: AuthenticatedConnection): Promise<void> {
    if (!this.allPageState) {
      this.sendSignalError(connection, "invalid-state", "No All-Page broadcast is active.");
      return;
    }

    if (this.allPageState.sessionToken !== connection.sessionToken && connection.user.role !== "admin") {
      this.sendSignalError(connection, "forbidden", "Only the pager or an admin can stop All-Page.");
      return;
    }

    // Stop pager's talk
    const pagerConnection = this.findAuthenticatedBySessionToken(this.allPageState.sessionToken);

    if (pagerConnection) {
      pagerConnection.state = {
        ...pagerConnection.state,
        talkChannelIds: [],
        talking: false,
      };
      this.operatorStates.set(pagerConnection.sessionToken, pagerConnection.state);
      this.sendOperatorState(pagerConnection);
      await this.syncMediaState(pagerConnection);
    }

    // Restore listen states (rebuild from preferences)
    for (const record of this.connections.values()) {
      if (!record.authenticated) {
        continue;
      }

      if (record.authenticated.sessionToken === this.allPageState.sessionToken) {
        continue;
      }

      // Rebuild operator state to restore defaults
      const restoredState = this.buildOperatorState(
        record.authenticated.user,
        record.authenticated.sessionToken,
      );

      // Keep current listen channels only if user had them before (state is rebuilt)
      record.authenticated.state = restoredState;
      this.operatorStates.set(record.authenticated.sessionToken, restoredState);
      this.sendOperatorState(record.authenticated);
      await this.syncMediaState(record.authenticated);
    }

    try { this.options.database.logEvent({ event_type: "allpage:stop", user_id: connection.user.id, username: connection.user.username }); } catch { /* never crash */ }

    this.allPageState = undefined;

    // Broadcast allpage:inactive to all clients
    const inactiveMessage: ServerSignalingMessage = {
      type: "allpage:inactive",
      payload: {},
    };

    for (const record of this.connections.values()) {
      if (record.authenticated) {
        this.sendMessage(record.socket, inactiveMessage);
      }
    }

    this.broadcastAdminDashboard();
  }

  // --- Call Signaling ---

  private handleSignalSend(connection: AuthenticatedConnection, payload: {
    signalType: CallSignalType;
    targetChannelId?: string;
    targetUserId?: string;
  }): void {
    if (!payload.targetChannelId && !payload.targetUserId) {
      this.sendSignalError(connection, "invalid-message", "Signal must target a channel or user.");
      return;
    }

    // Permission check: must have talk permission on target channel, or be admin/operator for user targets
    if (payload.targetChannelId) {
      const permission = connection.user.channelPermissions.find(
        (p) => p.channelId === payload.targetChannelId,
      );

      if (!permission?.canTalk && connection.user.role !== "admin" && connection.user.role !== "operator") {
        this.sendSignalError(connection, "forbidden", "Cannot send signal to that channel.");
        return;
      }
    }

    if (payload.targetUserId && connection.user.role !== "admin" && connection.user.role !== "operator") {
      this.sendSignalError(connection, "forbidden", "Only admins and operators can signal specific users.");
      return;
    }

    this.signalSequence += 1;
    const signalId = `sig-${this.signalSequence}-${Date.now()}`;

    const timer = setTimeout(() => {
      this.clearSignal(signalId);
    }, 30_000);

    const activeSignal: ActiveSignal = {
      fromUserId: connection.user.id,
      fromUsername: connection.user.username,
      signalId,
      signalType: payload.signalType,
      targetChannelId: payload.targetChannelId,
      targetUserId: payload.targetUserId,
      timer,
    };

    this.activeSignals.set(signalId, activeSignal);

    // Route signal to recipients
    const incomingMessage: ServerSignalingMessage = {
      type: "signal:incoming",
      payload: {
        signalId,
        signalType: payload.signalType,
        fromUserId: connection.user.id,
        fromUsername: connection.user.username,
        targetChannelId: payload.targetChannelId,
      },
    };

    for (const record of this.connections.values()) {
      if (!record.authenticated) {
        continue;
      }

      // Don't send to the sender
      if (record.authenticated.user.id === connection.user.id) {
        continue;
      }

      if (payload.targetUserId) {
        // Direct user signal
        if (record.authenticated.user.id === payload.targetUserId) {
          this.sendMessage(record.socket, incomingMessage);
        }
      } else if (payload.targetChannelId) {
        // Channel signal — send to all listeners on that channel
        const hasPermission = record.authenticated.user.channelPermissions.some(
          (p) => p.channelId === payload.targetChannelId && p.canListen,
        );

        if (hasPermission) {
          this.sendMessage(record.socket, incomingMessage);
        }
      }
    }
  }

  private handleSignalAcknowledge(connection: AuthenticatedConnection, signalId: string): void {
    this.clearSignal(signalId);
  }

  private clearSignal(signalId: string): void {
    const signal = this.activeSignals.get(signalId);

    if (!signal) {
      return;
    }

    clearTimeout(signal.timer);
    this.activeSignals.delete(signalId);

    const clearedMessage: ServerSignalingMessage = {
      type: "signal:cleared",
      payload: { signalId },
    };

    for (const record of this.connections.values()) {
      if (record.authenticated) {
        this.sendMessage(record.socket, clearedMessage);
      }
    }
  }

  // --- Direct Calls ---

  private findConnectionByUserId(userId: string): { record: ConnectionRecord; auth: AuthenticatedConnection } | undefined {
    for (const record of this.connections.values()) {
      if (record.authenticated?.user.id === userId) {
        return { record, auth: record.authenticated };
      }
    }

    return undefined;
  }

  private findDirectCallForUser(sessionToken: string): DirectCall | undefined {
    for (const call of this.directCalls.values()) {
      if (call.initiatorSessionToken === sessionToken || call.targetSessionToken === sessionToken) {
        return call;
      }
    }

    return undefined;
  }

  private handleDirectCallRequest(connection: AuthenticatedConnection, targetUserId: string): void {
    if (targetUserId === connection.user.id) {
      this.sendSignalError(connection, "invalid-message", "Cannot call yourself.");
      return;
    }

    // Check if initiator is already in a direct call
    if (this.findDirectCallForUser(connection.sessionToken)) {
      this.sendSignalError(connection, "conflict", "You are already in a direct call.");
      return;
    }

    // Find target user
    const target = this.findConnectionByUserId(targetUserId);

    if (!target) {
      this.sendMessage(this.findSocket(connection), {
        type: "direct:ended",
        payload: { callId: "", reason: "unavailable" },
      });
      return;
    }

    // Check if target is already in a direct call
    if (this.findDirectCallForUser(target.auth.sessionToken)) {
      this.sendMessage(this.findSocket(connection), {
        type: "direct:ended",
        payload: { callId: "", reason: "busy" },
      });
      return;
    }

    this.directCallSequence += 1;
    const callId = `dc-${this.directCallSequence}-${Date.now()}`;

    const ringTimeout = setTimeout(() => {
      this.endDirectCall(callId, "unavailable");
    }, 30_000);

    const call: DirectCall = {
      callId,
      initiatorSessionToken: connection.sessionToken,
      initiatorUserId: connection.user.id,
      initiatorUsername: connection.user.username,
      targetSessionToken: target.auth.sessionToken,
      targetUserId,
      targetUsername: target.auth.user.username,
      state: "ringing",
      ringTimeout,
    };

    this.directCalls.set(callId, call);

    // Notify target of incoming call
    this.sendMessage(target.record.socket, {
      type: "direct:incoming",
      payload: {
        callId,
        fromUserId: connection.user.id,
        fromUsername: connection.user.username,
      },
    });
  }

  private async handleDirectCallAccept(connection: AuthenticatedConnection, callId: string): Promise<void> {
    const call = this.directCalls.get(callId);

    if (!call || call.state !== "ringing") {
      this.sendSignalError(connection, "invalid-state", "No ringing call found with that ID.");
      return;
    }

    if (call.targetSessionToken !== connection.sessionToken) {
      this.sendSignalError(connection, "forbidden", "Only the call target can accept.");
      return;
    }

    clearTimeout(call.ringTimeout);
    call.state = "active";

    const initiator = this.findAuthenticatedBySessionToken(call.initiatorSessionToken);

    // Notify both parties
    if (initiator) {
      this.sendMessage(this.findSocket(initiator), {
        type: "direct:active",
        payload: {
          callId,
          peerUserId: connection.user.id,
          peerUsername: connection.user.username,
        },
      });
    }

    this.sendMessage(this.findSocket(connection), {
      type: "direct:active",
      payload: {
        callId,
        peerUserId: call.initiatorUserId,
        peerUsername: call.initiatorUsername,
      },
    });

    // Set up audio routing via media reconciliation
    if (initiator) {
      await this.syncMediaState(initiator);
    }

    await this.syncMediaState(connection);
    this.broadcastAdminDashboard();
  }

  private handleDirectCallReject(connection: AuthenticatedConnection, callId: string): void {
    const call = this.directCalls.get(callId);

    if (!call || call.state !== "ringing") {
      this.sendSignalError(connection, "invalid-state", "No ringing call found with that ID.");
      return;
    }

    if (call.targetSessionToken !== connection.sessionToken) {
      this.sendSignalError(connection, "forbidden", "Only the call target can reject.");
      return;
    }

    this.endDirectCall(callId, "rejected");
  }

  private handleDirectCallEndRequest(connection: AuthenticatedConnection, callId: string): void {
    const call = this.directCalls.get(callId);

    if (!call) {
      this.sendSignalError(connection, "invalid-state", "No call found with that ID.");
      return;
    }

    if (call.initiatorSessionToken !== connection.sessionToken && call.targetSessionToken !== connection.sessionToken) {
      this.sendSignalError(connection, "forbidden", "You are not part of this call.");
      return;
    }

    void this.endDirectCall(callId, "ended");
  }

  private async endDirectCall(callId: string, reason: "rejected" | "ended" | "unavailable" | "busy"): Promise<void> {
    const call = this.directCalls.get(callId);

    if (!call) {
      return;
    }

    clearTimeout(call.ringTimeout);
    const wasActive = call.state === "active";
    this.directCalls.delete(callId);

    const endedMessage: ServerSignalingMessage = {
      type: "direct:ended",
      payload: { callId, reason },
    };

    const initiator = this.findAuthenticatedBySessionToken(call.initiatorSessionToken);
    const target = call.targetSessionToken
      ? this.findAuthenticatedBySessionToken(call.targetSessionToken)
      : undefined;

    if (initiator) {
      this.sendMessage(this.findSocket(initiator), endedMessage);
    }

    if (target) {
      this.sendMessage(this.findSocket(target), endedMessage);
    }

    // Reconcile media to remove direct call consumers
    if (wasActive) {
      if (initiator) {
        await this.syncMediaState(initiator);
      }

      if (target) {
        await this.syncMediaState(target);
      }

      this.broadcastAdminDashboard();
    }
  }

  // --- IFB (Interrupted Fold-Back) ---

  private static readonly DEFAULT_IFB_DUCK_LEVEL = 0.1;

  private async handleIFBStart(connection: AuthenticatedConnection, targetUserId: string): Promise<void> {
    const role = connection.user.role;

    if (role !== "admin" && role !== "operator") {
      this.sendSignalError(connection, "forbidden", "Only admins and operators can use IFB.");
      return;
    }

    if (targetUserId === connection.user.id) {
      this.sendSignalError(connection, "invalid-message", "Cannot IFB yourself.");
      return;
    }

    if (this.ifbState) {
      this.sendSignalError(connection, "conflict", "An IFB session is already active.");
      return;
    }

    const target = this.findConnectionByUserId(targetUserId);

    if (!target) {
      this.sendSignalError(connection, "invalid-state", "Target user is not online.");
      return;
    }

    this.ifbState = {
      directorSessionToken: connection.sessionToken,
      directorUserId: connection.user.id,
      directorUsername: connection.user.username,
      targetSessionToken: target.auth.sessionToken,
      targetUserId,
    };

    // Notify target that IFB is active
    this.sendMessage(target.record.socket, {
      type: "ifb:active",
      payload: {
        fromUserId: connection.user.id,
        fromUsername: connection.user.username,
        duckLevel: RealtimeService.DEFAULT_IFB_DUCK_LEVEL,
      },
    });

    // Reconcile media to add IFB audio route from director to target
    await this.syncMediaState(connection);
    await this.syncMediaState(target.auth);
    this.broadcastAdminDashboard();
  }

  private async handleIFBStop(connection: AuthenticatedConnection): Promise<void> {
    if (!this.ifbState) {
      this.sendSignalError(connection, "invalid-state", "No IFB session is active.");
      return;
    }

    if (this.ifbState.directorSessionToken !== connection.sessionToken && connection.user.role !== "admin") {
      this.sendSignalError(connection, "forbidden", "Only the IFB director or an admin can stop IFB.");
      return;
    }

    await this.endIFB();
  }

  private async endIFB(): Promise<void> {
    if (!this.ifbState) {
      return;
    }

    const { directorSessionToken, targetSessionToken } = this.ifbState;
    this.ifbState = undefined;

    // Notify target that IFB ended
    const targetConnection = this.findAuthenticatedBySessionToken(targetSessionToken);

    if (targetConnection) {
      this.sendMessage(this.findSocket(targetConnection), {
        type: "ifb:inactive",
        payload: {},
      });
      await this.syncMediaState(targetConnection);
    }

    const directorConnection = this.findAuthenticatedBySessionToken(directorSessionToken);

    if (directorConnection) {
      await this.syncMediaState(directorConnection);
    }

    this.broadcastAdminDashboard();
  }

  private broadcastOnlineUsers(): void {
    const onlineUsers: Array<{ id: string; username: string }> = [];

    for (const record of this.connections.values()) {
      if (!record.authenticated) {
        continue;
      }

      if (!onlineUsers.some((u) => u.id === record.authenticated!.user.id)) {
        onlineUsers.push({
          id: record.authenticated.user.id,
          username: record.authenticated.user.username,
        });
      }
    }

    onlineUsers.sort((a, b) => a.username.localeCompare(b.username));

    const message: ServerSignalingMessage = {
      type: "online:users",
      payload: { users: onlineUsers },
    };

    for (const record of this.connections.values()) {
      if (record.authenticated) {
        this.sendMessage(record.socket, message);
      }
    }
  }

  private getDirectCallPeerUsername(userId: string): string | undefined {
    for (const call of this.directCalls.values()) {
      if (call.state !== "active") {
        continue;
      }

      if (call.initiatorUserId === userId) {
        return call.targetUsername;
      }

      if (call.targetUserId === userId) {
        return call.initiatorUsername;
      }
    }

    return undefined;
  }

  private findAuthenticatedBySessionToken(sessionToken: string): AuthenticatedConnection | undefined {
    for (const record of this.connections.values()) {
      if (record.authenticated?.sessionToken === sessionToken) {
        return record.authenticated;
      }
    }

    return undefined;
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

      // Block non-source users from talking on program channels
      if (mode === "start") {
        const channel = connection.channels.find((ch) => ch.id === channelId);

        if (channel?.channelType === "program" && channel.sourceUserId !== connection.user.id) {
          this.sendSignalError(connection, "forbidden", "Only the designated source can talk on a program channel.");
          return;
        }
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

    try {
      const eventType = mode === "start" ? "talk:start" : "talk:stop";
      for (const channelId of channelIds) {
        this.options.database.logEvent({ event_type: eventType, user_id: connection.user.id, username: connection.user.username, channel_id: channelId });
      }
    } catch { /* never crash */ }
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

    const rawHost = connection.requestHost;
    const resolvedHost = isUsableMediaHost(rawHost) ? await resolveMediaHost(rawHost) : undefined;

    const authenticated: AuthenticatedConnection = {
      channels,
      connectHost: resolvedHost,
      sessionToken,
      state: nextState,
      user,
    };

    connection.authenticated = authenticated;
    this.operatorStates.set(sessionToken, nextState);

    const groups = this.options.database.listGroups();

    this.sendMessage(connection.socket, {
      type: "session:ready",
      payload: {
        protocolVersion: PROTOCOL_VERSION,
        connectedUsers: this.getConnectedUsersCount(),
        user,
        channels,
        groups,
        operatorState: nextState,
      },
    });

    await this.dispatchMediaMessages(
      (await this.options.mediaService?.registerSession(
        this.buildMediaSessionContext(authenticated),
      )) ?? [],
    );
    this.broadcastPresence();
    this.broadcastOnlineUsers();

    try { this.options.database.logEvent({ event_type: "user:connected", user_id: user.id, username: user.username }); } catch { /* never crash */ }

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
      // If this user was the allpage pager, end the allpage
      if (this.allPageState?.sessionToken === connection.authenticated.sessionToken) {
        this.allPageState = undefined;

        const inactiveMessage: ServerSignalingMessage = {
          type: "allpage:inactive",
          payload: {},
        };

        for (const record of this.connections.values()) {
          if (record.authenticated && record !== connection) {
            this.sendMessage(record.socket, inactiveMessage);
          }
        }
      }

      // End any active direct calls for this user
      const activeCall = this.findDirectCallForUser(connection.authenticated.sessionToken);

      if (activeCall) {
        await this.endDirectCall(activeCall.callId, "ended");
      }

      // End IFB if this user was the director or target
      if (
        this.ifbState &&
        (this.ifbState.directorSessionToken === connection.authenticated.sessionToken ||
          this.ifbState.targetSessionToken === connection.authenticated.sessionToken)
      ) {
        await this.endIFB();
      }

      connection.authenticated.state = {
        ...connection.authenticated.state,
        talkChannelIds: [],
        talking: false,
      };
      this.operatorStates.set(connection.authenticated.sessionToken, connection.authenticated.state);
    }

    if (connection.authenticated) {
      try { this.options.database.logEvent({ event_type: "user:disconnected", user_id: connection.authenticated.user.id, username: connection.authenticated.user.username }); } catch { /* never crash */ }
    }

    this.connections.delete(socket);
    await this.dispatchMediaMessages(
      connection.authenticated
        ? ((await this.options.mediaService?.unregisterSession(connection.authenticated.sessionToken)) ?? [])
        : [],
    );
    this.broadcastPresence();
    this.broadcastOnlineUsers();
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

    const groups = this.options.database.listGroups();

    this.sendMessage(connection.socket, {
      type: "session:ready",
      payload: {
        protocolVersion: PROTOCOL_VERSION,
        connectedUsers: this.getConnectedUsersCount(),
        user,
        channels,
        groups,
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
    const qualityByUser = new Map<string, ConnectionQuality>();
    const preflightByUser = new Map<string, PreflightStatus>();

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

      if (connection.authenticated.connectionQuality) {
        qualityByUser.set(userId, connection.authenticated.connectionQuality);
      }

      if (connection.authenticated.preflightStatus) {
        preflightByUser.set(userId, connection.authenticated.preflightStatus);
      }
    }

    return {
      allPageActive: this.allPageState
        ? { userId: this.allPageState.userId, username: this.allPageState.username }
        : undefined,
      channels: this.options.database.listChannels(),
      groups: this.options.database.listGroups(),
      users: this.options.database.listUsers().map((user) => {
        const activeTalkChannelIds = [...(talkChannelsByUser.get(user.id) ?? new Set<string>())].sort(
          (left, right) => left.localeCompare(right),
        );

        return {
          ...user,
          online: onlineUserIds.has(user.id),
          talking: activeTalkChannelIds.length > 0,
          activeTalkChannelIds,
          connectionQuality: qualityByUser.get(user.id),
          preflightStatus: preflightByUser.get(user.id),
          directCallPeer: this.getDirectCallPeerUsername(user.id),
          groupIds: this.options.database.getUserGroupIds(user.id),
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
      const role = connection.authenticated?.user.role;

      if (role !== "admin" && role !== "operator") {
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
        if (this.allPageState && this.allPageState.sessionToken !== connection.authenticated.sessionToken) {
          this.sendSignalError(connection.authenticated, "forbidden", "Talk is disabled during All-Page broadcast.");
          return;
        }

        await this.applyTalkChange(connection.authenticated, parsed.payload.channelIds, "start");
        return;
      }

      if (parsed.type === "talk:stop") {
        await this.applyTalkChange(connection.authenticated, parsed.payload.channelIds, "stop");
        return;
      }

      if (parsed.type === "quality:report") {
        connection.authenticated.connectionQuality = parsed.payload;
        this.broadcastAdminDashboard();
        return;
      }

      if (parsed.type === "preflight:result") {
        connection.authenticated.preflightStatus = parsed.payload.status;
        this.broadcastAdminDashboard();
        return;
      }

      if (parsed.type === "allpage:start") {
        await this.handleAllPageStart(connection.authenticated);
        return;
      }

      if (parsed.type === "allpage:stop") {
        await this.handleAllPageStop(connection.authenticated);
        return;
      }

      if (parsed.type === "signal:send") {
        this.handleSignalSend(connection.authenticated, parsed.payload);
        return;
      }

      if (parsed.type === "signal:ack") {
        this.handleSignalAcknowledge(connection.authenticated, parsed.payload.signalId);
        return;
      }

      if (parsed.type === "direct:request") {
        this.handleDirectCallRequest(connection.authenticated, parsed.payload.targetUserId);
        return;
      }

      if (parsed.type === "direct:accept") {
        await this.handleDirectCallAccept(connection.authenticated, parsed.payload.callId);
        return;
      }

      if (parsed.type === "direct:reject") {
        this.handleDirectCallReject(connection.authenticated, parsed.payload.callId);
        return;
      }

      if (parsed.type === "direct:end") {
        this.handleDirectCallEndRequest(connection.authenticated, parsed.payload.callId);
        return;
      }

      if (parsed.type === "ifb:start") {
        await this.handleIFBStart(connection.authenticated, parsed.payload.targetUserId);
        return;
      }

      if (parsed.type === "ifb:stop") {
        await this.handleIFBStop(connection.authenticated);
        return;
      }

      if (this.isMediaRequestMessage(parsed)) {
        try {
          await this.dispatchMediaMessages(
            (await this.options.mediaService?.handleRequest(
              this.buildMediaSessionContext(connection.authenticated),
              parsed,
            )) ?? [],
          );
        } catch (mediaError) {
          const requestId = "payload" in parsed && "requestId" in parsed.payload
            ? (parsed.payload as { requestId: string }).requestId
            : undefined;

          this.sendSignalError(
            connection.socket,
            "media-error",
            mediaError instanceof Error ? mediaError.message : "Media request failed.",
            requestId,
          );
        }
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

  private sendSignalError(target: AuthenticatedConnection | WebSocket, code: string, message: string, requestId?: string): void {
    const socket = target instanceof WebSocket ? target : this.findSocket(target);

    this.sendMessage(socket, {
      type: "signal:error",
      payload: {
        code,
        message,
        ...(requestId ? { requestId } : {}),
      },
    });
  }

  private buildMediaSessionContext(connection: AuthenticatedConnection): MediaSessionContext {
    // Find if this connection is in an active direct call
    const activeCall = this.findDirectCallForUser(connection.sessionToken);
    let directCallPeerSessionToken: string | undefined;

    if (activeCall?.state === "active") {
      directCallPeerSessionToken = activeCall.initiatorSessionToken === connection.sessionToken
        ? activeCall.targetSessionToken
        : activeCall.initiatorSessionToken;
    }

    // Find if this connection is the IFB target (receives director audio)
    let ifbPeerSessionToken: string | undefined;

    if (this.ifbState?.targetSessionToken === connection.sessionToken) {
      ifbPeerSessionToken = this.ifbState.directorSessionToken;
    }

    return {
      channels: connection.channels,
      connectHost: connection.connectHost,
      directCallPeerSessionToken,
      ifbPeerSessionToken,
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
