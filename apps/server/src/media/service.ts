import { createWorker } from "mediasoup";
import type {
  Consumer,
  DtlsParameters,
  Producer,
  Router,
  RouterRtpCodecCapability,
  RtpCapabilities,
  RtpParameters,
  WebRtcTransport,
  Worker,
  WorkerLogLevel,
} from "mediasoup/types";

import {
  type ChannelInfo,
  type MediaCapabilitiesRequestMessage,
  type MediaConsumerAvailableMessage,
  type MediaConsumerClosedMessage,
  type MediaParameterMap,
  type MediaConsumerResumeRequestMessage,
  type MediaConsumerResumedMessage,
  type MediaConsumerStateMessage,
  type MediaProducerCloseRequestMessage,
  type MediaProducerCreateRequestMessage,
  type MediaProducerCreatedMessage,
  type MediaRtpCapabilities,
  type MediaRtpParameters,
  type MediaTransportConnectedMessage,
  type MediaTransportConnectRequestMessage,
  type MediaTransportCreatedMessage,
  type MediaTransportCreateRequestMessage,
  type MediaTransportDirection,
  type OperatorState,
  type ServerSignalingMessage,
  type UserInfo,
} from "@cuecommx/protocol";

import { buildDesiredMediaRoutes } from "./routes.js";

export interface MediaSessionContext {
  channels: ChannelInfo[];
  connectHost?: string;
  sessionToken: string;
  state: OperatorState;
  user: UserInfo;
}

export interface TargetedServerMessage {
  message: ServerSignalingMessage;
  sessionToken: string;
}

export interface RealtimeMediaService {
  close(): Promise<void>;
  handleRequest(
    session: MediaSessionContext,
    message: MediaRequestMessage,
  ): Promise<TargetedServerMessage[]>;
  refreshSession(session: MediaSessionContext): Promise<TargetedServerMessage[]>;
  registerSession(session: MediaSessionContext): Promise<TargetedServerMessage[]>;
  unregisterSession(sessionToken: string): Promise<TargetedServerMessage[]>;
  updateOperatorState(session: MediaSessionContext): Promise<TargetedServerMessage[]>;
}

export interface CueCommXMediaServiceOptions {
  announcedIp?: string;
  logLevel: "debug" | "info" | "warn" | "error";
  onWorkerDied?: (error: Error) => void;
  rtcMaxPort: number;
  rtcMinPort: number;
}

export type MediaRequestMessage =
  | MediaCapabilitiesRequestMessage
  | MediaTransportCreateRequestMessage
  | MediaTransportConnectRequestMessage
  | MediaProducerCreateRequestMessage
  | MediaProducerCloseRequestMessage
  | MediaConsumerResumeRequestMessage;

interface MediaConsumerRecord {
  activeChannelIds: string[];
  consumer: Consumer;
  producerSessionToken: string;
  producerUserId: string;
  producerUsername: string;
}

interface MediaPeerSession {
  channels: ChannelInfo[];
  connectHost?: string;
  consumersByProducerSession: Map<string, MediaConsumerRecord>;
  producer?: Producer;
  recvTransport?: WebRtcTransport;
  sendTransport?: WebRtcTransport;
  sessionToken: string;
  state: OperatorState;
  user: UserInfo;
}

const AUDIO_ROUTER_CODECS: RouterRtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48_000,
    channels: 2,
    parameters: {
      useinbandfec: 1,
    },
    rtcpFeedback: [{ type: "transport-cc" }],
  },
];

function remapIceCandidatesForClient(
  candidates: WebRtcTransport["iceCandidates"],
  announcedHost?: string,
): WebRtcTransport["iceCandidates"] {
  if (!announcedHost) {
    return candidates;
  }

  return candidates.map((candidate) => ({
    ...candidate,
    address: announcedHost,
    ip: announcedHost,
  }));
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function toWorkerLogLevel(logLevel: CueCommXMediaServiceOptions["logLevel"]): WorkerLogLevel {
  switch (logLevel) {
    case "debug":
      return "debug";
    case "error":
      return "error";
    case "warn":
      return "warn";
    default:
      return "warn";
  }
}

function toMediaParameterMap(
  parameters: Record<string, unknown> | undefined,
): MediaParameterMap | undefined {
  if (!parameters) {
    return undefined;
  }

  const entries = Object.entries(parameters).filter((entry): entry is [string, string | number | boolean | null] => {
    const value = entry[1];
    return (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number" ||
      typeof value === "string"
    );
  });

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function toMediaRtpCapabilities(router: Router): MediaRtpCapabilities {
  return {
    codecs: (router.rtpCapabilities.codecs ?? [])
      .filter((codec) => codec.kind === "audio")
      .map((codec) => ({
        kind: "audio" as const,
        mimeType: codec.mimeType,
        clockRate: codec.clockRate,
        channels: codec.channels,
        parameters: toMediaParameterMap(codec.parameters),
        preferredPayloadType: codec.preferredPayloadType,
        rtcpFeedback: codec.rtcpFeedback ?? [],
      })),
    headerExtensions: (router.rtpCapabilities.headerExtensions ?? [])
      .filter((extension) => extension.kind === "audio")
      .map((extension) => ({
        direction: extension.direction,
        kind: "audio" as const,
        preferredEncrypt: extension.preferredEncrypt,
        preferredId: extension.preferredId,
        uri: extension.uri,
      })),
  };
}

function toMediaRtpParameters(rtpParameters: RtpParameters): MediaRtpParameters {
  return {
    codecs: rtpParameters.codecs.map((codec) => ({
      mimeType: codec.mimeType,
      payloadType: codec.payloadType,
      clockRate: codec.clockRate,
      channels: codec.channels,
      parameters: toMediaParameterMap(codec.parameters),
      rtcpFeedback: codec.rtcpFeedback ?? [],
    })),
    encodings: (rtpParameters.encodings ?? []).map((encoding) => ({
      codecPayloadType: encoding.codecPayloadType,
      dtx: encoding.dtx,
      maxBitrate: encoding.maxBitrate,
      rid: encoding.rid,
      scalabilityMode: encoding.scalabilityMode,
      ssrc: encoding.ssrc,
    })),
    headerExtensions: (rtpParameters.headerExtensions ?? []).map((extension) => ({
      encrypt: extension.encrypt,
      id: extension.id,
      parameters: toMediaParameterMap(extension.parameters),
      uri: extension.uri,
    })),
    mid: rtpParameters.mid,
    rtcp: rtpParameters.rtcp
      ? {
          cname: rtpParameters.rtcp.cname,
          reducedSize: rtpParameters.rtcp.reducedSize,
        }
      : undefined,
  };
}

function toMediasoupDtlsParameters(dtlsParameters: MediaTransportConnectRequestMessage["payload"]["dtlsParameters"]): DtlsParameters {
  return {
    role: dtlsParameters.role,
    fingerprints: dtlsParameters.fingerprints.map((fingerprint) => ({
      algorithm: fingerprint.algorithm,
      value: fingerprint.value,
    })),
  };
}

function toMediasoupRtpParameters(rtpParameters: MediaProducerCreateRequestMessage["payload"]["rtpParameters"]): RtpParameters {
  return {
    codecs: rtpParameters.codecs.map((codec) => ({
      mimeType: codec.mimeType,
      payloadType: codec.payloadType,
      clockRate: codec.clockRate,
      channels: codec.channels,
      parameters: codec.parameters,
      rtcpFeedback: codec.rtcpFeedback ?? [],
    })),
    encodings: rtpParameters.encodings.map((encoding) => ({
      codecPayloadType: encoding.codecPayloadType,
      dtx: encoding.dtx,
      maxBitrate: encoding.maxBitrate,
      rid: encoding.rid,
      scalabilityMode: encoding.scalabilityMode,
      ssrc: encoding.ssrc,
    })),
    headerExtensions: rtpParameters.headerExtensions.map((extension) => ({
      encrypt: extension.encrypt,
      id: extension.id,
      parameters: extension.parameters,
      uri: extension.uri,
    })),
    mid: rtpParameters.mid,
    rtcp: rtpParameters.rtcp
      ? {
          cname: rtpParameters.rtcp.cname,
          reducedSize: rtpParameters.rtcp.reducedSize,
        }
      : undefined,
  };
}

export class CueCommXMediaService implements RealtimeMediaService {
  private operationLock: Promise<unknown> = Promise.resolve();

  private readyPromise: Promise<void>;

  private router: Router | undefined;

  private readonly sessions = new Map<string, MediaPeerSession>();

  private worker: Worker | undefined;

  constructor(private readonly options: CueCommXMediaServiceOptions) {
    this.readyPromise = this.initialize();
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.operationLock.then(fn, fn);
    this.operationLock = result.then(() => undefined, () => undefined);
    return result;
  }

  async close(): Promise<void> {
    for (const session of this.sessions.values()) {
      this.closeSendTransport(session);
      this.closeRecvTransport(session);
    }

    this.sessions.clear();
    this.router?.close();
    this.router = undefined;
    this.worker?.close();
    this.worker = undefined;
    await this.readyPromise.catch(() => undefined);
  }

  async handleRequest(
    sessionContext: MediaSessionContext,
    message: MediaRequestMessage,
  ): Promise<TargetedServerMessage[]> {
    return this.serialize(() => this.doHandleRequest(sessionContext, message));
  }

  async refreshSession(sessionContext: MediaSessionContext): Promise<TargetedServerMessage[]> {
    return this.serialize(async () => {
      await this.ensureReady();
      this.upsertSession(sessionContext);
      return await this.reconcileConsumers();
    });
  }

  async registerSession(sessionContext: MediaSessionContext): Promise<TargetedServerMessage[]> {
    return this.serialize(async () => {
      await this.ensureReady();
      this.upsertSession(sessionContext);
      return [];
    });
  }

  async unregisterSession(sessionToken: string): Promise<TargetedServerMessage[]> {
    return this.serialize(async () => {
      await this.ensureReady();
      const session = this.sessions.get(sessionToken);

      if (!session) {
        return [];
      }

      this.closeSendTransport(session);
      this.closeRecvTransport(session);
      this.sessions.delete(sessionToken);

      return await this.reconcileConsumers();
    });
  }

  async updateOperatorState(sessionContext: MediaSessionContext): Promise<TargetedServerMessage[]> {
    return this.serialize(async () => {
      await this.ensureReady();
      this.upsertSession(sessionContext);
      return await this.reconcileConsumers();
    });
  }

  private async doHandleRequest(
    sessionContext: MediaSessionContext,
    message: MediaRequestMessage,
  ): Promise<TargetedServerMessage[]> {
    await this.ensureReady();

    if (message.type === "media:capabilities:get") {
      return [this.createMediaCapabilitiesResponse(sessionContext.sessionToken, message)];
    }

    const session = this.upsertSession(sessionContext);

    if (message.type === "media:transport:create") {
      return await this.handleTransportCreate(session, message);
    }

    if (message.type === "media:transport:connect") {
      return await this.handleTransportConnect(session, message);
    }

    if (message.type === "media:producer:create") {
      return await this.handleProducerCreate(session, message);
    }

    if (message.type === "media:producer:close") {
      return await this.handleProducerClose(session, message);
    }

    return await this.handleConsumerResume(session, message);
  }

  private async ensureReady(): Promise<void> {
    await this.readyPromise;

    if (!this.router || !this.worker) {
      throw new Error("CueCommX media worker is not ready.");
    }
  }

  private createMediaCapabilitiesResponse(
    sessionToken: string,
    message: MediaCapabilitiesRequestMessage,
  ): TargetedServerMessage {
    if (!this.router) {
      throw new Error("CueCommX media router is not ready.");
    }

    return {
      sessionToken,
      message: {
        type: "media:capabilities",
        payload: {
          requestId: message.payload.requestId,
          routerRtpCapabilities: toMediaRtpCapabilities(this.router),
        },
      },
    };
  }

  private closeRecvTransport(session: MediaPeerSession): void {
    for (const record of session.consumersByProducerSession.values()) {
      record.consumer.close();
    }

    session.consumersByProducerSession.clear();
    session.recvTransport?.close();
    session.recvTransport = undefined;
  }

  private closeSendTransport(session: MediaPeerSession): void {
    session.producer?.close();
    session.producer = undefined;
    session.sendTransport?.close();
    session.sendTransport = undefined;
  }

  private async createWebRtcTransport(
    direction: MediaTransportDirection,
    sessionToken: string,
    announcedHost?: string,
  ): Promise<WebRtcTransport> {
    if (!this.router) {
      throw new Error("CueCommX media router is not ready.");
    }

    return await this.router.createWebRtcTransport({
      listenIps: [
        {
          ip: "0.0.0.0",
          announcedIp: announcedHost ?? this.options.announcedIp,
        },
      ],
      enableTcp: true,
      enableUdp: true,
      preferUdp: true,
      appData: {
        direction,
        sessionToken,
      },
    });
  }

  private findConsumerById(session: MediaPeerSession, consumerId: string): MediaConsumerRecord | undefined {
    for (const record of session.consumersByProducerSession.values()) {
      if (record.consumer.id === consumerId) {
        return record;
      }
    }

    return undefined;
  }

  private findTransport(session: MediaPeerSession, transportId: string): WebRtcTransport | undefined {
    if (session.sendTransport?.id === transportId) {
      return session.sendTransport;
    }

    if (session.recvTransport?.id === transportId) {
      return session.recvTransport;
    }

    return undefined;
  }

  private async handleConsumerResume(
    session: MediaPeerSession,
    message: MediaConsumerResumeRequestMessage,
  ): Promise<TargetedServerMessage[]> {
    const consumerRecord = this.findConsumerById(session, message.payload.consumerId);

    if (!consumerRecord) {
      throw new Error("CueCommX media consumer was not found for this session.");
    }

    await consumerRecord.consumer.resume();

    console.log(`[CueCommX media] consumer resumed: ${message.payload.consumerId.slice(0, 8)} for ${session.user.username}`);
    const response: MediaConsumerResumedMessage = {
      type: "media:consumer:resumed",
      payload: {
        requestId: message.payload.requestId,
        consumerId: consumerRecord.consumer.id,
      },
    };

    return [
      {
        sessionToken: session.sessionToken,
        message: response,
      },
    ];
  }

  private async handleProducerClose(
    session: MediaPeerSession,
    message: MediaProducerCloseRequestMessage,
  ): Promise<TargetedServerMessage[]> {
    if (!session.producer || session.producer.id !== message.payload.producerId) {
      throw new Error("CueCommX media producer was not found for this session.");
    }

    session.producer.close();
    session.producer = undefined;

    const notifications = await this.reconcileConsumers();

    return [
      {
        sessionToken: session.sessionToken,
        message: {
          type: "media:producer:closed",
          payload: {
            requestId: message.payload.requestId,
            producerId: message.payload.producerId,
          },
        },
      },
      ...notifications,
    ];
  }

  private async handleProducerCreate(
    session: MediaPeerSession,
    message: MediaProducerCreateRequestMessage,
  ): Promise<TargetedServerMessage[]> {
    if (!session.sendTransport || session.sendTransport.id !== message.payload.transportId) {
      throw new Error("CueCommX send transport is not ready for producer creation.");
    }

    session.producer?.close();
    session.producer = await session.sendTransport.produce({
      kind: "audio",
      rtpParameters: toMediasoupRtpParameters(message.payload.rtpParameters),
      appData: {
        sessionToken: session.sessionToken,
        userId: session.user.id,
      },
    });

    console.log(`[CueCommX media] producer created for ${session.user.username} (${session.sessionToken.slice(0, 8)})`);

    const response: MediaProducerCreatedMessage = {
      type: "media:producer:created",
      payload: {
        requestId: message.payload.requestId,
        producerId: session.producer.id,
      },
    };

    const notifications = await this.reconcileConsumers();

    return [
      {
        sessionToken: session.sessionToken,
        message: response,
      },
      ...notifications,
    ];
  }

  private async handleTransportConnect(
    session: MediaPeerSession,
    message: MediaTransportConnectRequestMessage,
  ): Promise<TargetedServerMessage[]> {
    const transport = this.findTransport(session, message.payload.transportId);

    if (!transport) {
      throw new Error("CueCommX media transport was not found for this session.");
    }

    await transport.connect({
      dtlsParameters: toMediasoupDtlsParameters(message.payload.dtlsParameters),
    });

    const response: MediaTransportConnectedMessage = {
      type: "media:transport:connected",
      payload: {
        requestId: message.payload.requestId,
        transportId: transport.id,
      },
    };

    const notifications =
      session.recvTransport?.id === transport.id ? await this.reconcileConsumers() : [];

    return [
      {
        sessionToken: session.sessionToken,
        message: response,
      },
      ...notifications,
    ];
  }

  private async handleTransportCreate(
    session: MediaPeerSession,
    message: MediaTransportCreateRequestMessage,
  ): Promise<TargetedServerMessage[]> {
    const announcedHost = session.connectHost ?? this.options.announcedIp;

    console.log(`[CueCommX media] transport:create ${message.payload.direction} for ${session.user.username}, announcedHost=${announcedHost ?? "(none)"}, connectHost=${session.connectHost ?? "(none)"}, configIp=${this.options.announcedIp ?? "(none)"}`);

    if (message.payload.direction === "send") {
      this.closeSendTransport(session);
      session.sendTransport = await this.createWebRtcTransport(
        "send",
        session.sessionToken,
        announcedHost,
      );
    } else {
      this.closeRecvTransport(session);
      session.recvTransport = await this.createWebRtcTransport(
        "recv",
        session.sessionToken,
        announcedHost,
      );
    }

    const transport =
      message.payload.direction === "send" ? session.sendTransport : session.recvTransport;

    if (!transport) {
      throw new Error("CueCommX media transport could not be created.");
    }

    const response: MediaTransportCreatedMessage = {
      type: "media:transport:created",
      payload: {
        requestId: message.payload.requestId,
        transport: {
          direction: message.payload.direction,
          dtlsParameters: transport.dtlsParameters,
          iceCandidates: remapIceCandidatesForClient(transport.iceCandidates, announcedHost),
          iceParameters: transport.iceParameters,
          id: transport.id,
        },
      },
    };

    return [
      {
        sessionToken: session.sessionToken,
        message: response,
      },
    ];
  }

  private async initialize(): Promise<void> {
    const worker = await createWorker({
      logLevel: toWorkerLogLevel(this.options.logLevel),
      rtcMinPort: this.options.rtcMinPort,
      rtcMaxPort: this.options.rtcMaxPort,
    });

    worker.on("died", (error) => {
      void this.handleWorkerDied(error);
    });

    const router = await worker.createRouter({
      mediaCodecs: AUDIO_ROUTER_CODECS,
    });

    this.worker = worker;
    this.router = router;
  }

  private async handleWorkerDied(error: Error): Promise<void> {
    for (const session of this.sessions.values()) {
      this.closeSendTransport(session);
      this.closeRecvTransport(session);
    }

    this.sessions.clear();
    this.router = undefined;
    this.worker = undefined;
    this.options.onWorkerDied?.(error);
    this.readyPromise = this.initialize();
    await this.readyPromise;
  }

  private removeConsumer(
    session: MediaPeerSession,
    producerSessionToken: string,
  ): TargetedServerMessage | undefined {
    const record = session.consumersByProducerSession.get(producerSessionToken);

    if (!record) {
      return undefined;
    }

    record.consumer.close();
    session.consumersByProducerSession.delete(producerSessionToken);

    const message: MediaConsumerClosedMessage = {
      type: "media:consumer:closed",
      payload: {
        consumerId: record.consumer.id,
      },
    };

    return {
      sessionToken: session.sessionToken,
      message,
    };
  }

  private async reconcileConsumers(): Promise<TargetedServerMessage[]> {
    if (!this.router) {
      return [];
    }

    const notifications: TargetedServerMessage[] = [];
    const sessionSnapshots = [...this.sessions.values()].map((session) => ({
      sessionToken: session.sessionToken,
      userId: session.user.id,
      talkChannelIds: session.state.talkChannelIds,
      listenChannelIds: session.state.listenChannelIds,
      hasProducer: !!session.producer,
      hasRecvTransport: !!session.recvTransport,
    }));

    console.log(`[CueCommX media] reconcile: ${sessionSnapshots.length} sessions`, sessionSnapshots.map((s) => `${s.userId.slice(0, 8)}(prod=${s.hasProducer},recv=${s.hasRecvTransport},talk=[${s.talkChannelIds}],listen=[${s.listenChannelIds}])`).join(", "));

    const desiredRoutes = buildDesiredMediaRoutes(sessionSnapshots);

    console.log(`[CueCommX media] reconcile: ${desiredRoutes.length} desired route(s)`, desiredRoutes.map((r) => `${r.producerUserId.slice(0, 8)}->[${r.activeChannelIds}]->${r.listenerSessionToken.slice(0, 8)}`).join(", "));

    const desiredRoutesByListener = new Map<string, Map<string, (typeof desiredRoutes)[number]>>();

    for (const route of desiredRoutes) {
      const perListener = desiredRoutesByListener.get(route.listenerSessionToken) ?? new Map();
      perListener.set(route.producerSessionToken, route);
      desiredRoutesByListener.set(route.listenerSessionToken, perListener);
    }

    for (const session of this.sessions.values()) {
      const desiredForListener = desiredRoutesByListener.get(session.sessionToken) ?? new Map();

      for (const producerSessionToken of [...session.consumersByProducerSession.keys()]) {
        const desiredRoute = desiredForListener.get(producerSessionToken);

        if (!desiredRoute) {
          const closedMessage = this.removeConsumer(session, producerSessionToken);

          if (closedMessage) {
            notifications.push(closedMessage);
          }

          continue;
        }

        const record = session.consumersByProducerSession.get(producerSessionToken);
        const producerSession = this.sessions.get(producerSessionToken);

        if (!record || !producerSession) {
          continue;
        }

        const producerUsername = producerSession.user.username;

        if (
          arraysEqual(record.activeChannelIds, desiredRoute.activeChannelIds) &&
          record.producerUsername === producerUsername
        ) {
          continue;
        }

        record.activeChannelIds = desiredRoute.activeChannelIds;
        record.producerUserId = producerSession.user.id;
        record.producerUsername = producerUsername;

        const stateMessage: MediaConsumerStateMessage = {
          type: "media:consumer:state",
          payload: {
            consumerId: record.consumer.id,
            producerUserId: producerSession.user.id,
            producerUsername,
            activeChannelIds: desiredRoute.activeChannelIds,
          },
        };

        notifications.push({
          sessionToken: session.sessionToken,
          message: stateMessage,
        });
      }

      for (const route of desiredForListener.values()) {
        if (session.consumersByProducerSession.has(route.producerSessionToken)) {
          continue;
        }

        if (!session.recvTransport) {
          continue;
        }

        const producerSession = this.sessions.get(route.producerSessionToken);

        if (!producerSession?.producer) {
          continue;
        }

        if (
          !this.router.canConsume({
            producerId: producerSession.producer.id,
            rtpCapabilities: this.router.rtpCapabilities,
          })
        ) {
          continue;
        }

        const consumer = await session.recvTransport.consume({
          producerId: producerSession.producer.id,
          rtpCapabilities: this.router.rtpCapabilities,
          paused: true,
          ignoreDtx: false,
        });
        const record: MediaConsumerRecord = {
          activeChannelIds: route.activeChannelIds,
          consumer,
          producerSessionToken: route.producerSessionToken,
          producerUserId: producerSession.user.id,
          producerUsername: producerSession.user.username,
        };

        session.consumersByProducerSession.set(route.producerSessionToken, record);
        consumer.on("producerclose", () => {
          session.consumersByProducerSession.delete(route.producerSessionToken);
        });
        consumer.on("transportclose", () => {
          session.consumersByProducerSession.delete(route.producerSessionToken);
        });

        console.log(`[CueCommX media] consumer created: ${producerSession.user.username} -> ${session.user.username} on [${route.activeChannelIds}] (consumer ${consumer.id.slice(0, 8)})`);

        const availableMessage: MediaConsumerAvailableMessage = {
          type: "media:consumer:available",
          payload: {
            consumerId: consumer.id,
            producerId: producerSession.producer.id,
            producerUserId: producerSession.user.id,
            producerUsername: producerSession.user.username,
            kind: "audio",
            activeChannelIds: route.activeChannelIds,
            rtpParameters: toMediaRtpParameters(consumer.rtpParameters),
          },
        };

        notifications.push({
          sessionToken: session.sessionToken,
          message: availableMessage,
        });
      }
    }

    return notifications;
  }

  private upsertSession(sessionContext: MediaSessionContext): MediaPeerSession {
    const existing = this.sessions.get(sessionContext.sessionToken);

    if (existing) {
      existing.channels = sessionContext.channels;
      existing.connectHost = sessionContext.connectHost;
      existing.state = sessionContext.state;
      existing.user = sessionContext.user;
      return existing;
    }

    const session: MediaPeerSession = {
      channels: sessionContext.channels,
      connectHost: sessionContext.connectHost,
      consumersByProducerSession: new Map(),
      sessionToken: sessionContext.sessionToken,
      state: sessionContext.state,
      user: sessionContext.user,
    };

    this.sessions.set(sessionContext.sessionToken, session);
    return session;
  }
}
