import { Device } from "mediasoup-client";
import type {
  Consumer,
  DtlsParameters as MediasoupDtlsParameters,
  Producer,
  ProducerOptions,
  RtpCapabilities as MediasoupRtpCapabilities,
  RtpParameters as MediasoupRtpParameters,
  Transport,
  TransportOptions as MediasoupTransportOptions,
} from "mediasoup-client/types";
import type {
  MediaConsumerAvailableMessage,
  MediaConsumerStateMessage,
  MediaDtlsParameters,
  MediaParameterMap,
  MediaRtpCapabilities,
  MediaRtpHeaderExtensionUri,
  MediaRtpParameters,
  MediaTransportOptions,
  ServerSignalingMessage,
} from "@cuecommx/protocol";
import { CueCommXRealtimeClient } from "@cuecommx/core";
import {
  MediaStream,
  mediaDevices,
  type MediaStreamTrack as ReactNativeMediaStreamTrack,
} from "react-native-webrtc";

import {
  type AudioEnergySnapshot,
  computeRmsLevel,
  extractAudioLevelFromStats,
  extractEnergySnapshot,
} from "./audio-stats";

export interface MobileRemoteTalkerSnapshot {
  activeChannelIds: string[];
  consumerId: string;
  producerUserId: string;
  producerUsername: string;
}

export interface MobileMediaControllerOptions {
  onError?: (error: Error) => void;
  onLocalLevelChange?: (level: number) => void;
  onRemoteTalkersChange?: (talkers: MobileRemoteTalkerSnapshot[]) => void;
  realtimeClient: CueCommXRealtimeClient;
}

interface RemoteConsumerRecord {
  activeChannelIds: string[];
  consumer: Consumer;
  producerUserId: string;
  producerUsername: string;
  stream: MediaStream;
  track: ReactNativeAudioTrack;
}

interface MixSettings {
  activeListenChannelIds: string[];
  channelVolumes: Record<string, number>;
  masterVolume: number;
}

type ReactNativeAudioTrack = ReactNativeMediaStreamTrack & {
  _setVolume?: (volume: number) => void;
};

type ProducerTrack = NonNullable<ProducerOptions["track"]>;

const DEFAULT_MIX_SETTINGS: MixSettings = {
  activeListenChannelIds: [],
  channelVolumes: {},
  masterVolume: 1,
};

const SUPPORTED_HEADER_EXTENSION_URIS = new Set<MediaRtpHeaderExtensionUri>([
  "urn:ietf:params:rtp-hdrext:sdes:mid",
  "urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id",
  "urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id",
  "urn:ietf:params:rtp-hdrext:ssrc-audio-level",
  "urn:3gpp:video-orientation",
  "urn:ietf:params:rtp-hdrext:toffset",
  "http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01",
  "http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time",
  "http://www.webrtc.org/experiments/rtp-hdrext/abs-capture-time",
  "http://www.webrtc.org/experiments/rtp-hdrext/playout-delay",
  "https://aomediacodec.github.io/av1-rtp-spec/#dependency-descriptor-rtp-header-extension",
]);

function isSupportedHeaderExtensionUri(uri: string): uri is MediaRtpHeaderExtensionUri {
  return SUPPORTED_HEADER_EXTENSION_URIS.has(uri as MediaRtpHeaderExtensionUri);
}

function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getRemoteConsumerVolume(activeChannelIds: readonly string[], settings: MixSettings): number {
  const matchingChannelIds = activeChannelIds.filter((channelId) =>
    settings.activeListenChannelIds.includes(channelId),
  );

  if (matchingChannelIds.length === 0) {
    return 0;
  }

  const loudestChannel = Math.max(
    ...matchingChannelIds.map((channelId) => settings.channelVolumes[channelId] ?? 1),
  );

  return clampVolume(settings.masterVolume * loudestChannel);
}

function toMediasoupParameterMap(
  parameters: MediaParameterMap | undefined,
): Record<string, unknown> | undefined {
  if (!parameters) {
    return undefined;
  }

  return { ...parameters };
}

function toMediasoupDtlsParameters(
  dtlsParameters: MediaDtlsParameters,
): MediasoupDtlsParameters {
  return {
    role: dtlsParameters.role,
    fingerprints: dtlsParameters.fingerprints.map((fingerprint) => ({
      algorithm: fingerprint.algorithm,
      value: fingerprint.value,
    })),
  };
}

function toMediasoupRtpCapabilities(
  routerRtpCapabilities: MediaRtpCapabilities,
): MediasoupRtpCapabilities {
  return {
    codecs: routerRtpCapabilities.codecs.map((codec) => {
      if (codec.preferredPayloadType === undefined) {
        throw new Error("CueCommX router capabilities are missing a preferred payload type.");
      }

      return {
        kind: codec.kind,
        mimeType: codec.mimeType,
        preferredPayloadType: codec.preferredPayloadType,
        clockRate: codec.clockRate,
        channels: codec.channels,
        parameters: toMediasoupParameterMap(codec.parameters),
        rtcpFeedback: codec.rtcpFeedback ?? [],
      };
    }),
    headerExtensions: routerRtpCapabilities.headerExtensions.map((extension) => {
      if (extension.preferredId === undefined) {
        throw new Error("CueCommX router capabilities are missing a preferred header extension id.");
      }

      return {
        kind: extension.kind ?? "audio",
        uri: extension.uri,
        preferredId: extension.preferredId,
        preferredEncrypt: extension.preferredEncrypt,
        direction: extension.direction,
      };
    }),
  };
}

function toMediasoupRtpParameters(rtpParameters: MediaRtpParameters): MediasoupRtpParameters {
  return {
    codecs: rtpParameters.codecs.map((codec) => ({
      mimeType: codec.mimeType,
      payloadType: codec.payloadType,
      clockRate: codec.clockRate,
      channels: codec.channels,
      parameters: toMediasoupParameterMap(codec.parameters),
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
      parameters: toMediasoupParameterMap(extension.parameters),
      uri: extension.uri,
    })),
    mid: rtpParameters.mid,
    rtcp: rtpParameters.rtcp
      ? {
          cname: rtpParameters.rtcp.cname,
          mux: rtpParameters.rtcp.mux,
          reducedSize: rtpParameters.rtcp.reducedSize,
        }
      : undefined,
  };
}

function toProtocolParameterMap(
  parameters: Record<string, unknown> | undefined,
): MediaParameterMap | undefined {
  if (!parameters) {
    return undefined;
  }

  const entries = Object.entries(parameters).filter(
    (entry): entry is [string, string | number | boolean | null] => {
      const value = entry[1];
      return (
        value === null ||
        typeof value === "boolean" ||
        typeof value === "number" ||
        typeof value === "string"
      );
    },
  );

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function toProtocolRtpParameters(rtpParameters: MediasoupRtpParameters): MediaRtpParameters {
  return {
    codecs: rtpParameters.codecs.map((codec) => ({
      mimeType: codec.mimeType,
      payloadType: codec.payloadType,
      clockRate: codec.clockRate,
      channels: codec.channels,
      parameters: toProtocolParameterMap(codec.parameters),
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
    headerExtensions: (rtpParameters.headerExtensions ?? []).flatMap((extension) => {
      if (!isSupportedHeaderExtensionUri(extension.uri)) {
        return [];
      }

      return [
        {
          encrypt: extension.encrypt,
          id: extension.id,
          parameters: toProtocolParameterMap(extension.parameters),
          uri: extension.uri,
        },
      ];
    }),
    mid: rtpParameters.mid,
    rtcp: rtpParameters.rtcp
      ? {
          cname: rtpParameters.rtcp.cname,
          mux: rtpParameters.rtcp.mux,
          reducedSize: rtpParameters.rtcp.reducedSize,
        }
      : undefined,
  };
}

function toMediasoupTransportOptions(
  transport: MediaTransportOptions,
): MediasoupTransportOptions {
  return {
    id: transport.id,
    iceParameters: {
      usernameFragment: transport.iceParameters.usernameFragment,
      password: transport.iceParameters.password,
      iceLite: transport.iceParameters.iceLite,
    },
    iceCandidates: transport.iceCandidates.map((candidate) => ({
      foundation: candidate.foundation,
      priority: candidate.priority,
      address: candidate.address ?? candidate.ip,
      ip: candidate.ip,
      protocol: candidate.protocol,
      port: candidate.port,
      type: candidate.type,
      tcpType: candidate.tcpType,
    })),
    dtlsParameters: toMediasoupDtlsParameters(transport.dtlsParameters),
  };
}

export class MobileMediaController {
  private device: Device | undefined;

  private lastEnergySnapshot: AudioEnergySnapshot | undefined;

  private lastBytesSent: number | undefined;

  private localLevelTimer: ReturnType<typeof setInterval> | undefined;

  private localStream: MediaStream | undefined;

  private mixSettings: MixSettings = DEFAULT_MIX_SETTINGS;

  private readonly pendingConsumers = new Map<string, MediaConsumerAvailableMessage["payload"]>();

  private producer: Producer | undefined;

  private readonly remoteConsumers = new Map<string, RemoteConsumerRecord>();

  private recvTransport: Transport | undefined;

  private sendTransport: Transport | undefined;

  constructor(private readonly options: MobileMediaControllerOptions) {}

  async close(): Promise<void> {
    this.resetConnection();
    this.stopLocalLevelPolling();
    this.stopLocalStream();
    this.device = undefined;
    this.options.onLocalLevelChange?.(0);
    this.emitRemoteTalkers();
  }

  async handleServerMessage(message: ServerSignalingMessage): Promise<void> {
    if (message.type === "media:consumer:available") {
      if (!this.recvTransport) {
        this.pendingConsumers.set(message.payload.consumerId, message.payload);
        return;
      }

      await this.consumeRemoteAudio(message.payload);
      return;
    }

    if (message.type === "media:consumer:state") {
      this.updateRemoteConsumerState(message.payload);
      return;
    }

    if (message.type === "media:consumer:closed") {
      this.removeRemoteConsumer(message.payload.consumerId);
    }
  }

  resetConnection(): void {
    this.producer?.close();
    this.producer = undefined;
    this.stopLocalLevelPolling();
    this.sendTransport?.close();
    this.sendTransport = undefined;
    this.recvTransport?.close();
    this.recvTransport = undefined;
    this.pendingConsumers.clear();

    for (const consumerId of [...this.remoteConsumers.keys()]) {
      this.removeRemoteConsumer(consumerId);
    }
  }

  async start(): Promise<void> {
    const START_TIMEOUT_MS = 15_000;

    const result = await Promise.race([
      this.doStart(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Audio setup timed out after 15 seconds. Please try again.")),
          START_TIMEOUT_MS,
        ),
      ),
    ]);

    return result;
  }

  private async doStart(): Promise<void> {
    await this.ensureLocalCapture();

    if (!this.device) {
      this.device = await Device.factory({ handlerName: "ReactNative106" });
      const routerRtpCapabilities = await this.options.realtimeClient.requestMediaCapabilities();

      await this.device.load({
        routerRtpCapabilities: toMediasoupRtpCapabilities(routerRtpCapabilities),
      });
    }

    if (!this.sendTransport || !this.recvTransport) {
      await this.setupTransports();
    }

    if (!this.producer) {
      const track = this.getLocalTrack();

      this.producer = await this.sendTransport!.produce({
        track: track as unknown as ProducerTrack,
        codecOptions: {
          opusDtx: true,
          opusFec: true,
          opusPtime: 10,
          opusStereo: false,
        },
        disableTrackOnPause: false,
        stopTracks: false,
        zeroRtpOnPause: false,
      });
    }

    this.startLocalLevelPolling();
    await this.consumePendingRemoteAudio();
    this.updateMix(this.mixSettings);
  }

  updateMix(settings: Partial<MixSettings>): void {
    this.mixSettings = {
      ...this.mixSettings,
      ...settings,
    };

    for (const record of this.remoteConsumers.values()) {
      const volume = getRemoteConsumerVolume(record.activeChannelIds, this.mixSettings);

      record.track.enabled = volume > 0;
      record.track._setVolume?.(Math.max(0, Math.min(10, volume * 10)));
    }
  }

  private async consumePendingRemoteAudio(): Promise<void> {
    for (const payload of [...this.pendingConsumers.values()]) {
      await this.consumeRemoteAudio(payload);
    }

    this.pendingConsumers.clear();
  }

  private async consumeRemoteAudio(
    payload: MediaConsumerAvailableMessage["payload"],
  ): Promise<void> {
    if (!this.recvTransport || this.remoteConsumers.has(payload.consumerId)) {
      return;
    }

    try {
      const consumer = await this.recvTransport.consume({
        id: payload.consumerId,
        producerId: payload.producerId,
        kind: payload.kind,
        rtpParameters: toMediasoupRtpParameters(payload.rtpParameters),
      });
      const track = consumer.track as unknown as ReactNativeAudioTrack;
      const stream = new MediaStream([track]);

      const record: RemoteConsumerRecord = {
        activeChannelIds: payload.activeChannelIds,
        consumer,
        producerUserId: payload.producerUserId,
        producerUsername: payload.producerUsername,
        stream,
        track,
      };

      this.remoteConsumers.set(payload.consumerId, record);
      this.updateMix(this.mixSettings);
      this.emitRemoteTalkers();
      await this.options.realtimeClient.resumeMediaConsumer(payload.consumerId);
    } catch (error) {
      this.options.onError?.(
        error instanceof Error ? error : new Error("Unable to consume CueCommX remote audio."),
      );
    }
  }

  private async ensureLocalCapture(): Promise<ReactNativeAudioTrack> {
    if (this.localStream) {
      return this.getLocalTrack();
    }

    const stream = await mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    const [track] = stream.getAudioTracks();

    if (!track) {
      throw new Error("CueCommX did not receive an audio track from this device.");
    }

    this.localStream = stream;
    track.enabled = true;

    return track as ReactNativeAudioTrack;
  }

  private emitRemoteTalkers(): void {
    this.options.onRemoteTalkersChange?.(
      [...this.remoteConsumers.entries()]
        .map(([consumerId, record]) => ({
          consumerId,
          producerUserId: record.producerUserId,
          producerUsername: record.producerUsername,
          activeChannelIds: record.activeChannelIds,
        }))
        .sort((left, right) => left.producerUsername.localeCompare(right.producerUsername)),
    );
  }

  private getLocalTrack(): ReactNativeAudioTrack {
    const [track] = this.localStream?.getAudioTracks() ?? [];

    if (!track) {
      throw new Error("CueCommX local audio track is not available.");
    }

    return track as ReactNativeAudioTrack;
  }

  private removeRemoteConsumer(consumerId: string): void {
    const record = this.remoteConsumers.get(consumerId);

    if (!record) {
      return;
    }

    record.track.enabled = false;
    record.consumer.close();
    record.stream.release();
    this.remoteConsumers.delete(consumerId);
    this.emitRemoteTalkers();
  }

  private async setupTransports(): Promise<void> {
    if (!this.device) {
      throw new Error("CueCommX mediasoup Device is not ready.");
    }

    const sendTransportOptions = await this.options.realtimeClient.createMediaTransport("send");
    const recvTransportOptions = await this.options.realtimeClient.createMediaTransport("recv");

    this.sendTransport = this.device.createSendTransport(
      toMediasoupTransportOptions(sendTransportOptions),
    );
    this.recvTransport = this.device.createRecvTransport(
      toMediasoupTransportOptions(recvTransportOptions),
    );

    this.sendTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
      void this.options.realtimeClient
        .connectMediaTransport(sendTransportOptions.id, dtlsParameters)
        .then(callback)
        .catch((error: unknown) => errback(error instanceof Error ? error : new Error(String(error))));
    });
    this.sendTransport.on("produce", ({ rtpParameters }, callback, errback) => {
      void this.options.realtimeClient
        .createMediaProducer(sendTransportOptions.id, toProtocolRtpParameters(rtpParameters))
        .then((id) => callback({ id }))
        .catch((error: unknown) => errback(error instanceof Error ? error : new Error(String(error))));
    });
    this.sendTransport.on("connectionstatechange", (state) => {
      if (state === "failed" || state === "disconnected" || state === "closed") {
        this.options.onError?.(new Error(`CueCommX mobile send transport entered ${state}.`));
      }
    });

    this.recvTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
      void this.options.realtimeClient
        .connectMediaTransport(recvTransportOptions.id, dtlsParameters)
        .then(callback)
        .catch((error: unknown) => errback(error instanceof Error ? error : new Error(String(error))));
    });
    this.recvTransport.on("connectionstatechange", (state) => {
      if (state === "failed" || state === "disconnected" || state === "closed") {
        this.options.onError?.(new Error(`CueCommX mobile receive transport entered ${state}.`));
      }
    });
  }

  private stopLocalStream(): void {
    for (const track of this.localStream?.getTracks() ?? []) {
      track.stop();
    }

    this.localStream?.release(true);
    this.localStream = undefined;
  }

  private startLocalLevelPolling(): void {
    if (!this.producer || this.localLevelTimer) {
      return;
    }

    this.lastEnergySnapshot = undefined;
    this.lastBytesSent = undefined;
    let reading = false;
    let statsLogCount = 0;

    this.localLevelTimer = setInterval(() => {
      if (reading || !this.producer) {
        return;
      }

      reading = true;
      void this.producer
        .getStats()
        .then((stats) => {
          // One-time diagnostic dump of stats structure
          if (statsLogCount < 3) {
            statsLogCount++;
            const entries: Record<string, unknown>[] = [];

            if (stats instanceof Map) {
              for (const [key, value] of stats) {
                entries.push({ key, ...(typeof value === "object" ? value : {}) } as Record<string, unknown>);
              }
            }

            console.log(`[CueCommX] mic stats dump #${statsLogCount}:`, JSON.stringify(entries, null, 2));
          }

          // Strategy 1: direct audioLevel (browsers)
          const directLevel = extractAudioLevelFromStats(stats);

          if (directLevel !== undefined) {
            this.options.onLocalLevelChange?.(Math.min(100, Math.round(directLevel * 100)));
            return;
          }

          // Strategy 2: energy-based RMS (react-native-webrtc media-source stats)
          const snapshot = extractEnergySnapshot(stats);

          if (snapshot) {
            if (this.lastEnergySnapshot) {
              const rms = computeRmsLevel(this.lastEnergySnapshot, snapshot);

              if (rms !== undefined) {
                this.options.onLocalLevelChange?.(Math.min(100, Math.round(rms * 100)));
              }
            }

            this.lastEnergySnapshot = snapshot;
            return;
          }

          // Strategy 3: bytes-sent delta as crude activity indicator
          const bytesSent = this.extractBytesSent(stats);

          if (bytesSent !== undefined) {
            if (this.lastBytesSent !== undefined) {
              const delta = bytesSent - this.lastBytesSent;
              // Rough heuristic: ~6000 bytes/150ms at 48kHz mono Opus = active speech
              const level = Math.min(100, Math.round((delta / 6000) * 60));

              this.options.onLocalLevelChange?.(Math.max(0, level));
            }

            this.lastBytesSent = bytesSent;
          }
        })
        .catch((err) => {
          if (statsLogCount < 5) {
            console.warn("[CueCommX] mic stats error:", err);
          }
        })
        .finally(() => {
          reading = false;
        });
    }, 150);
  }

  private extractBytesSent(stats: unknown): number | undefined {
    if (!(stats instanceof Map)) {
      return undefined;
    }

    for (const value of stats.values()) {
      if (
        typeof value === "object" &&
        value !== null &&
        (value as Record<string, unknown>).type === "outbound-rtp" &&
        typeof (value as Record<string, unknown>).bytesSent === "number"
      ) {
        return (value as Record<string, unknown>).bytesSent as number;
      }
    }

    return undefined;
  }

  private stopLocalLevelPolling(): void {
    if (!this.localLevelTimer) {
      return;
    }

    clearInterval(this.localLevelTimer);
    this.localLevelTimer = undefined;
    this.lastEnergySnapshot = undefined;
    this.lastBytesSent = undefined;
    this.options.onLocalLevelChange?.(0);
  }

  private updateRemoteConsumerState(payload: MediaConsumerStateMessage["payload"]): void {
    const record = this.remoteConsumers.get(payload.consumerId);

    if (!record) {
      return;
    }

    record.activeChannelIds = payload.activeChannelIds;
    record.producerUserId = payload.producerUserId;
    record.producerUsername = payload.producerUsername;
    this.updateMix(this.mixSettings);
    this.emitRemoteTalkers();
  }
}

export function createMobileMediaController(
  options: MobileMediaControllerOptions,
): MobileMediaController {
  return new MobileMediaController(options);
}
