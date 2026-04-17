import {
  type ConnectionQuality,
  type MediaCapabilitiesMessage,
  type MediaDtlsParameters,
  type MediaProducerClosedMessage,
  type MediaProducerCreatedMessage,
  type MediaRtpCapabilities,
  type MediaRtpParameters,
  type MediaTransportConnectedMessage,
  type MediaTransportCreatedMessage,
  type MediaTransportDirection,
  type PreflightStatus,
  parseServerSignalingMessage,
  type ClientSignalingMessage,
  type MediaConsumerResumedMessage,
  type ServerSignalingMessage,
} from "@cuecommx/protocol";

import { getReconnectDelay, type ReconnectOptions } from "./reconnect.js";

export type RealtimeConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "closed";

type TimeoutHandle = ReturnType<typeof globalThis.setTimeout>;

interface RealtimeWebSocketEventMap {
  close: CloseEvent;
  error: Event;
  message: MessageEvent<string>;
  open: Event;
}

export interface RealtimeWebSocket {
  addEventListener<K extends keyof RealtimeWebSocketEventMap>(
    type: K,
    listener: (event: RealtimeWebSocketEventMap[K]) => void,
  ): void;
  close(code?: number, reason?: string): void;
  readyState: number;
  removeEventListener?<K extends keyof RealtimeWebSocketEventMap>(
    type: K,
    listener: (event: RealtimeWebSocketEventMap[K]) => void,
  ): void;
  send(data: string): void;
}

export interface CueCommXRealtimeClientOptions {
  baseUrl: string;
  clearTimeout?: typeof globalThis.clearTimeout;
  createWebSocket?: (url: string) => RealtimeWebSocket;
  onConnectionStateChange?: (state: RealtimeConnectionState) => void;
  onError?: (error: Error) => void;
  onMessage?: (message: ServerSignalingMessage) => void;
  requestTimeoutMs?: number;
  reconnect?: ReconnectOptions;
  sessionToken: string;
  setTimeout?: typeof globalThis.setTimeout;
  websocketPath?: string;
}

const DEFAULT_WEBSOCKET_PATH = "/ws";
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const WEBSOCKET_OPEN = 1;

type MediaResponseMessage =
  | MediaCapabilitiesMessage
  | MediaTransportCreatedMessage
  | MediaTransportConnectedMessage
  | MediaProducerCreatedMessage
  | MediaProducerClosedMessage
  | MediaConsumerResumedMessage;

interface PendingRequest {
  expectedType: MediaResponseMessage["type"];
  reject: (error: Error) => void;
  resolve: (message: MediaResponseMessage) => void;
  timer: TimeoutHandle;
}

export function buildRealtimeWebSocketUrl(
  baseUrl: string,
  websocketPath: string = DEFAULT_WEBSOCKET_PATH,
): string {
  const url = new URL(websocketPath, baseUrl);

  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  }

  return url.toString();
}

function defaultCreateWebSocket(url: string): RealtimeWebSocket {
  if (typeof globalThis.WebSocket !== "function") {
    throw new Error("WebSocket is not available in this runtime.");
  }

  return new globalThis.WebSocket(url);
}

export class CueCommXRealtimeClient {
  private manuallyClosed = false;

  private readonly pendingRequests = new Map<string, PendingRequest>();

  private reconnectAttempt = 0;

  private reconnectTimer: TimeoutHandle | undefined;

  private requestSequence = 0;

  private socket: RealtimeWebSocket | undefined;

  constructor(private readonly options: CueCommXRealtimeClientOptions) {}

  connect(): void {
    if (this.socket || this.reconnectTimer) {
      return;
    }

    this.manuallyClosed = false;
    this.openSocket(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
  }

  disconnect(): void {
    this.manuallyClosed = true;
    this.clearReconnectTimer();
    this.rejectPendingRequests(new Error("CueCommX realtime connection closed."));

    if (this.socket) {
      this.detachSocket(this.socket);
      this.socket.close(1000, "client disconnect");
      this.socket = undefined;
    }

    this.emitConnectionState("closed");
  }

  startTalk(channelIds: string[]): void {
    this.sendClientMessage({
      type: "talk:start",
      payload: {
        channelIds,
      },
    });
  }

  stopTalk(channelIds: string[]): void {
    this.sendClientMessage({
      type: "talk:stop",
      payload: {
        channelIds,
      },
    });
  }

  toggleListen(channelId: string, listening: boolean): void {
    this.sendClientMessage({
      type: "listen:toggle",
      payload: {
        channelId,
        listening,
      },
    });
  }

  reportConnectionQuality(quality: ConnectionQuality): void {
    this.sendClientMessage({
      type: "quality:report",
      payload: quality,
    });
  }

  reportPreflightResult(status: PreflightStatus): void {
    this.sendClientMessage({
      type: "preflight:result",
      payload: { status },
    });
  }

  startAllPage(): void {
    this.sendClientMessage({
      type: "allpage:start",
      payload: {},
    });
  }

  stopAllPage(): void {
    this.sendClientMessage({
      type: "allpage:stop",
      payload: {},
    });
  }

  sendCallSignal(
    signalType: "call" | "standby" | "go",
    target: { channelId?: string; userId?: string },
  ): void {
    this.sendClientMessage({
      type: "signal:send",
      payload: {
        signalType,
        targetChannelId: target.channelId,
        targetUserId: target.userId,
      },
    });
  }

  acknowledgeSignal(signalId: string): void {
    this.sendClientMessage({
      type: "signal:ack",
      payload: { signalId },
    });
  }

  requestDirectCall(targetUserId: string): void {
    this.sendClientMessage({
      type: "direct:request",
      payload: { targetUserId },
    });
  }

  acceptDirectCall(callId: string): void {
    this.sendClientMessage({
      type: "direct:accept",
      payload: { callId },
    });
  }

  rejectDirectCall(callId: string): void {
    this.sendClientMessage({
      type: "direct:reject",
      payload: { callId },
    });
  }

  endDirectCall(callId: string): void {
    this.sendClientMessage({
      type: "direct:end",
      payload: { callId },
    });
  }

  async requestMediaCapabilities(): Promise<MediaRtpCapabilities> {
    const response = await this.sendRequest("media:capabilities", (requestId) => ({
      type: "media:capabilities:get",
      payload: {
        requestId,
      },
    }));

    return response.payload.routerRtpCapabilities;
  }

  async createMediaTransport(
    direction: MediaTransportDirection,
  ): Promise<MediaTransportCreatedMessage["payload"]["transport"]> {
    const response = await this.sendRequest("media:transport:created", (requestId) => ({
      type: "media:transport:create",
      payload: {
        requestId,
        direction,
      },
    }));

    return response.payload.transport;
  }

  async connectMediaTransport(
    transportId: string,
    dtlsParameters: MediaDtlsParameters,
  ): Promise<void> {
    await this.sendRequest("media:transport:connected", (requestId) => ({
      type: "media:transport:connect",
      payload: {
        requestId,
        transportId,
        dtlsParameters,
      },
    }));
  }

  async createMediaProducer(
    transportId: string,
    rtpParameters: MediaRtpParameters,
  ): Promise<string> {
    const response = await this.sendRequest("media:producer:created", (requestId) => ({
      type: "media:producer:create",
      payload: {
        requestId,
        transportId,
        kind: "audio",
        rtpParameters,
      },
    }));

    return response.payload.producerId;
  }

  async closeMediaProducer(producerId: string): Promise<void> {
    await this.sendRequest("media:producer:closed", (requestId) => ({
      type: "media:producer:close",
      payload: {
        requestId,
        producerId,
      },
    }));
  }

  async resumeMediaConsumer(consumerId: string): Promise<void> {
    await this.sendRequest("media:consumer:resumed", (requestId) => ({
      type: "media:consumer:resume",
      payload: {
        requestId,
        consumerId,
      },
    }));
  }

  private attachSocket(socket: RealtimeWebSocket): void {
    socket.addEventListener("open", this.handleOpen);
    socket.addEventListener("message", this.handleMessage);
    socket.addEventListener("close", this.handleClose);
    socket.addEventListener("error", this.handleError);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) {
      return;
    }

    (this.options.clearTimeout ?? globalThis.clearTimeout)(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private detachSocket(socket: RealtimeWebSocket): void {
    socket.removeEventListener?.("open", this.handleOpen);
    socket.removeEventListener?.("message", this.handleMessage);
    socket.removeEventListener?.("close", this.handleClose);
    socket.removeEventListener?.("error", this.handleError);
  }

  private emitConnectionState(state: RealtimeConnectionState): void {
    this.options.onConnectionStateChange?.(state);
  }

  private openSocket(state: RealtimeConnectionState): void {
    const websocket = (this.options.createWebSocket ?? defaultCreateWebSocket)(
      buildRealtimeWebSocketUrl(this.options.baseUrl, this.options.websocketPath),
    );

    this.socket = websocket;
    this.attachSocket(websocket);
    this.emitConnectionState(state);
  }

  private readonly handleClose = (): void => {
    const socket = this.socket;

    if (socket) {
      this.detachSocket(socket);
      this.socket = undefined;
    }

     this.rejectPendingRequests(new Error("CueCommX realtime connection closed."));

    if (this.manuallyClosed) {
      this.emitConnectionState("closed");
      return;
    }

    this.scheduleReconnect();
  };

  private readonly handleError = (): void => {
    this.options.onError?.(new Error("CueCommX realtime connection error."));
  };

  private readonly handleMessage = (event: MessageEvent<string>): void => {
    try {
      const parsed = parseServerSignalingMessage(JSON.parse(event.data));
      this.resolvePendingRequest(parsed);

      this.options.onMessage?.(parsed);

      if (parsed.type === "signal:error") {
        if (parsed.payload.requestId) {
          this.rejectPendingRequestById(parsed.payload.requestId, new Error(parsed.payload.message));
        }

        this.options.onError?.(new Error(parsed.payload.message));
      }
    } catch (error) {
      this.options.onError?.(
        error instanceof Error ? error : new Error("Unable to parse realtime message."),
      );
    }
  };

  private readonly handleOpen = (): void => {
    this.reconnectAttempt = 0;
    this.emitConnectionState("connected");
    this.sendClientMessage({
      type: "session:authenticate",
      payload: {
        sessionToken: this.options.sessionToken,
      },
    });
  };

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `cuecommx-request-${this.requestSequence}`;
  }

  private rejectPendingRequests(error: Error): void {
    for (const [requestId, request] of this.pendingRequests) {
      (this.options.clearTimeout ?? globalThis.clearTimeout)(request.timer);
      request.reject(error);
      this.pendingRequests.delete(requestId);
    }
  }

  private rejectPendingRequestById(requestId: string, error: Error): void {
    const pending = this.pendingRequests.get(requestId);

    if (!pending) {
      return;
    }

    (this.options.clearTimeout ?? globalThis.clearTimeout)(pending.timer);
    this.pendingRequests.delete(requestId);
    pending.reject(error);
  }

  private resolvePendingRequest(message: ServerSignalingMessage): void {
    const requestId = this.getRequestId(message);

    if (!requestId) {
      return;
    }

    const pending = this.pendingRequests.get(requestId);

    if (!pending || pending.expectedType !== message.type) {
      return;
    }

    (this.options.clearTimeout ?? globalThis.clearTimeout)(pending.timer);
    this.pendingRequests.delete(requestId);
    pending.resolve(message);
  }

  private scheduleReconnect(): void {
    const attempt = this.reconnectAttempt + 1;
    const delay = getReconnectDelay(attempt, this.options.reconnect);

    this.reconnectAttempt = attempt;
    this.emitConnectionState("reconnecting");
    this.clearReconnectTimer();

    this.reconnectTimer = (this.options.setTimeout ?? globalThis.setTimeout)(() => {
      this.reconnectTimer = undefined;
      this.openSocket("reconnecting");
    }, delay);
  }

  private async sendRequest<TType extends MediaResponseMessage["type"]>(
    expectedType: TType,
    buildMessage: (requestId: string) => ClientSignalingMessage,
  ): Promise<Extract<MediaResponseMessage, { type: TType }>> {
    const requestId = this.nextRequestId();

    return await new Promise((resolve, reject) => {
      const timer = (this.options.setTimeout ?? globalThis.setTimeout)(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`CueCommX realtime request timed out: ${expectedType}.`));
      }, this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, {
        expectedType,
        reject,
        resolve: (message) => resolve(message as Extract<MediaResponseMessage, { type: TType }>),
        timer,
      });

      try {
        this.sendClientMessage(buildMessage(requestId));
      } catch (error) {
        (this.options.clearTimeout ?? globalThis.clearTimeout)(timer);
        this.pendingRequests.delete(requestId);
        reject(
          error instanceof Error ? error : new Error("Unable to send CueCommX realtime request."),
        );
      }
    });
  }

  private sendClientMessage(message: ClientSignalingMessage): void {
    if (!this.socket || this.socket.readyState !== WEBSOCKET_OPEN) {
      throw new Error("CueCommX realtime connection is not open.");
    }

    this.socket.send(JSON.stringify(message));
  }

  private getRequestId(message: ServerSignalingMessage): string | undefined {
    switch (message.type) {
      case "media:capabilities":
      case "media:transport:created":
      case "media:transport:connected":
      case "media:producer:created":
      case "media:producer:closed":
      case "media:consumer:resumed":
        return message.payload.requestId;
      default:
        return undefined;
    }
  }
}
