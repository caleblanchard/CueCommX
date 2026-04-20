import { Device } from "mediasoup-client";
import type {
  Consumer,
  DtlsParameters as MediasoupDtlsParameters,
  Producer,
  RtpCapabilities as MediasoupRtpCapabilities,
  RtpParameters as MediasoupRtpParameters,
  Transport,
  TransportOptions as MediasoupTransportOptions,
} from "mediasoup-client/types";
import type {
  ConnectionQuality,
  ConnectionQualityGrade,
  MediaConsumerAvailableMessage,
  MediaConsumerStateMessage,
  MediaDtlsParameters,
  MediaParameterMap,
  MediaRtpHeaderExtensionUri,
  MediaRtpCapabilities,
  MediaRtpParameters,
  MediaTransportOptions,
  ServerSignalingMessage,
} from "@cuecommx/protocol";
import { CueCommXRealtimeClient } from "@cuecommx/core";

import type {
  AudioProcessingPreferences,
} from "../preferences.js";
import { DEFAULT_AUDIO_PROCESSING } from "../preferences.js";

export interface MediaDeviceOption {
  deviceId: string;
  label: string;
}

export interface RemoteTalkerSnapshot {
  activeChannelIds: string[];
  consumerId: string;
  producerUserId: string;
  producerUsername: string;
}

export interface WebMediaControllerOptions {
  onConnectionQualityChange?: (quality: ConnectionQuality | undefined) => void;
  onError?: (error: Error) => void;
  onInputDevicesChange?: (devices: MediaDeviceOption[]) => void;
  onLocalLevelChange?: (level: number) => void;
  onRemoteLevelsChange?: (levels: Record<string, number>) => void;
  onRemoteTalkersChange?: (talkers: RemoteTalkerSnapshot[]) => void;
  realtimeClient: CueCommXRealtimeClient;
}

interface RemoteConsumerRecord {
  activeChannelIds: string[];
  analyserNode?: AnalyserNode;
  audioElement: HTMLAudioElement;
  consumer: Consumer;
  gainNode?: GainNode;
  panNode?: StereoPannerNode;
  producerUserId: string;
  producerUsername: string;
  sourceNode?: MediaElementAudioSourceNode;
}

export interface MixSettings {
  activeListenChannelIds: string[];
  activeTalkerChannelIds: string[];
  channelPans: Record<string, number>;
  channelPriorities: Record<string, number>;
  channelVolumes: Record<string, number>;
  duckingEnabled: boolean;
  duckLevel: number;
  masterVolume: number;
}

const DEFAULT_MIX_SETTINGS: MixSettings = {
  activeListenChannelIds: [],
  activeTalkerChannelIds: [],
  channelPans: {},
  channelPriorities: {},
  channelVolumes: {},
  duckingEnabled: false,
  duckLevel: 0.3,
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

function toMediasoupParameterMap(parameters: MediaParameterMap | undefined): Record<string, unknown> | undefined {
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

export function toMediasoupRtpCapabilities(
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

export function toProtocolParameterMap(
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

export function toProtocolRtpParameters(rtpParameters: MediasoupRtpParameters): MediaRtpParameters {
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

export function toMediasoupTransportOptions(
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

export function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function getAudioCaptureCapabilityError(
  mediaDevices: Pick<MediaDevices, "getUserMedia" | "enumerateDevices"> | undefined,
  context: {
    hostname?: string;
    isSecureContext?: boolean;
  } = {},
): string | undefined {
  if (typeof mediaDevices?.getUserMedia === "function") {
    return undefined;
  }

  const hostname = context.hostname?.toLowerCase();
  const isLoopbackHost =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

  if (context.isSecureContext === false && !isLoopbackHost) {
    return "CueCommX browser audio requires HTTPS on iPhone/iPad browsers and other secure-context-only environments. Open CueCommX over HTTPS or use the native mobile app.";
  }

  return "This browser does not expose the microphone APIs CueCommX needs for audio capture.";
}

export function canEnumerateInputDevices(
  mediaDevices: Pick<MediaDevices, "enumerateDevices"> | undefined,
): mediaDevices is Pick<MediaDevices, "enumerateDevices"> & {
  enumerateDevices: NonNullable<MediaDevices["enumerateDevices"]>;
} {
  return typeof mediaDevices?.enumerateDevices === "function";
}

function getAudioContextConstructor():
  | (new () => AudioContext)
  | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.AudioContext ?? (window as typeof window & { webkitAudioContext?: new () => AudioContext }).webkitAudioContext;
}

export function getRemoteConsumerVolume(
  activeChannelIds: readonly string[],
  settings: MixSettings,
): number {
  const matchingChannelIds = activeChannelIds.filter((channelId) =>
    settings.activeListenChannelIds.includes(channelId),
  );

  if (matchingChannelIds.length === 0) {
    return 0;
  }

  const loudestChannel = Math.max(
    ...matchingChannelIds.map((channelId) => settings.channelVolumes[channelId] ?? 1),
  );

  let volume = clampVolume(settings.masterVolume * loudestChannel);

  // Audio ducking: reduce volume of lower-priority channels when
  // a higher-priority channel has active talkers
  if (settings.duckingEnabled && settings.activeTalkerChannelIds.length > 0) {
    const highestActivePriority = Math.max(
      ...settings.activeTalkerChannelIds.map((id) => settings.channelPriorities[id] ?? 5),
    );
    const consumerMaxPriority = Math.max(
      ...matchingChannelIds.map((id) => settings.channelPriorities[id] ?? 5),
    );
    if (consumerMaxPriority < highestActivePriority) {
      volume *= settings.duckLevel;
    }
  }

  return volume;
}

export function getRemoteConsumerPan(
  activeChannelIds: readonly string[],
  settings: MixSettings,
): number {
  const matchingIds = activeChannelIds.filter((id) =>
    settings.activeListenChannelIds.includes(id),
  );

  if (matchingIds.length === 0) {
    return 0;
  }

  const pans = matchingIds.map((id) => settings.channelPans[id] ?? 0);
  return Math.max(-1, Math.min(1, pans.reduce((sum, p) => sum + p, 0) / pans.length));
}

const QUALITY_THRESHOLDS = {
  excellent: { maxRttMs: 30, maxLossPercent: 0.5, maxJitterMs: 5 },
  good: { maxRttMs: 50, maxLossPercent: 1, maxJitterMs: 15 },
  fair: { maxRttMs: 100, maxLossPercent: 5, maxJitterMs: 30 },
} as const;

export function computeQualityGrade(
  rttMs: number,
  lossPercent: number,
  jitterMs: number,
): ConnectionQualityGrade {
  for (const [grade, thresholds] of Object.entries(QUALITY_THRESHOLDS) as [
    ConnectionQualityGrade,
    (typeof QUALITY_THRESHOLDS)[keyof typeof QUALITY_THRESHOLDS],
  ][]) {
    if (
      rttMs <= thresholds.maxRttMs &&
      lossPercent <= thresholds.maxLossPercent &&
      jitterMs <= thresholds.maxJitterMs
    ) {
      return grade;
    }
  }

  return "poor";
}

export function extractConnectionQuality(
  stats: RTCStatsReport,
): ConnectionQuality | undefined {
  let selectedPair: RTCIceCandidatePairStats | undefined;

  for (const report of stats.values()) {
    if (report.type === "candidate-pair" && (report as RTCIceCandidatePairStats).nominated) {
      selectedPair = report as RTCIceCandidatePairStats;
      break;
    }
  }

  if (!selectedPair) {
    return undefined;
  }

  const rttMs = (selectedPair.currentRoundTripTime ?? 0) * 1_000;

  let lossPercent = 0;

  for (const report of stats.values()) {
    if (report.type === "outbound-rtp") {
      const outbound = report as RTCOutboundRtpStreamStats;
      const totalPackets = (outbound.packetsSent ?? 0) + (outbound.nackCount ?? 0);

      if (totalPackets > 0 && (outbound.nackCount ?? 0) > 0) {
        lossPercent = ((outbound.nackCount ?? 0) / totalPackets) * 100;
      }

      break;
    }
  }

  let jitterMs = 0;

  for (const report of stats.values()) {
    if (report.type === "remote-inbound-rtp") {
      jitterMs = ((report as { jitter?: number }).jitter ?? 0) * 1_000;
      break;
    }
  }

  const grade = computeQualityGrade(rttMs, lossPercent, jitterMs);

  return {
    grade,
    roundTripTimeMs: Math.round(rttMs * 10) / 10,
    packetLossPercent: Math.round(lossPercent * 100) / 100,
    jitterMs: Math.round(jitterMs * 10) / 10,
  };
}

export class WebMediaController {
  private analyserNode: AnalyserNode | undefined;

  private audioContext: AudioContext | undefined;

  private audioProcessing: AudioProcessingPreferences = { ...DEFAULT_AUDIO_PROCESSING };

  private currentInputDeviceId: string | undefined;

  private device: Device | undefined;

  private inputLevelTimer: number | undefined;

  private localAudioSource: MediaStreamAudioSourceNode | undefined;

  private localStream: MediaStream | undefined;

  private mixSettings: MixSettings = DEFAULT_MIX_SETTINGS;

  private readonly pendingConsumers = new Map<string, MediaConsumerAvailableMessage["payload"]>();

  private producer: Producer | undefined;

  private qualityTimer: number | undefined;

  private readonly remoteConsumers = new Map<string, RemoteConsumerRecord>();

  private remoteLevelTimer: number | undefined;

  private recvTransport: Transport | undefined;

  private sendTransport: Transport | undefined;

  private sidetoneEnabled = false;

  private sidetoneGainNode: GainNode | null = null;

  private sidetoneLevel = 0.15;

  constructor(private readonly options: WebMediaControllerOptions) {}

  getVoxAudioNodes(): { audioContext: AudioContext; sourceNode: MediaStreamAudioSourceNode } | undefined {
    if (!this.audioContext || !this.localAudioSource) {
      return undefined;
    }

    return { audioContext: this.audioContext, sourceNode: this.localAudioSource };
  }

  enableSidetone(level: number): void {
    this.sidetoneLevel = Math.max(0, Math.min(0.3, level));
    this.sidetoneEnabled = true;

    if (!this.audioContext || !this.localAudioSource) {
      return;
    }

    if (!this.sidetoneGainNode) {
      this.sidetoneGainNode = this.audioContext.createGain();
      this.localAudioSource.connect(this.sidetoneGainNode);
      this.sidetoneGainNode.connect(this.audioContext.destination);
    }

    this.sidetoneGainNode.gain.value = this.sidetoneLevel;
  }

  disableSidetone(): void {
    this.sidetoneEnabled = false;

    if (this.sidetoneGainNode) {
      this.sidetoneGainNode.disconnect();
      this.sidetoneGainNode = null;
    }
  }

  setSidetoneLevel(level: number): void {
    this.sidetoneLevel = Math.max(0, Math.min(0.3, level));

    if (this.sidetoneGainNode) {
      this.sidetoneGainNode.gain.value = this.sidetoneLevel;
    }
  }

  setAudioProcessing(processing: AudioProcessingPreferences): void {
    this.audioProcessing = { ...processing };
  }

  async close(): Promise<void> {
    this.resetConnection();
    this.stopMeter();
    this.stopRemoteLevelMeter();
    this.stopQualityMonitor();

    if (this.sidetoneGainNode) {
      this.sidetoneGainNode.disconnect();
      this.sidetoneGainNode = null;
    }

    this.localAudioSource?.disconnect();
    this.localAudioSource = undefined;
    this.analyserNode?.disconnect();
    this.analyserNode = undefined;

    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = undefined;
    }

    this.stopLocalStream();
    this.device = undefined;
    this.currentInputDeviceId = undefined;
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
    this.stopQualityMonitor();
    this.stopRemoteLevelMeter();
    this.producer?.close();
    this.producer = undefined;
    this.sendTransport?.close();
    this.sendTransport = undefined;
    this.recvTransport?.close();
    this.recvTransport = undefined;
    this.pendingConsumers.clear();

    for (const consumerId of [...this.remoteConsumers.keys()]) {
      this.removeRemoteConsumer(consumerId);
    }
  }

  async start(inputDeviceId?: string): Promise<void> {
    await this.ensureLocalCapture(inputDeviceId);

    if (!this.device) {
      this.device = await Device.factory();
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
        track,
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

    await this.consumePendingRemoteAudio();
    this.updateMix(this.mixSettings);
    this.startQualityMonitor();
  }

  async switchInputDevice(inputDeviceId?: string): Promise<void> {
    const nextTrack = await this.ensureLocalCapture(inputDeviceId);

    if (this.producer) {
      await this.producer.replaceTrack({
        track: nextTrack,
      });
    }
  }

  updateMix(settings: Partial<MixSettings>): void {
    this.mixSettings = {
      ...this.mixSettings,
      ...settings,
    };

    for (const record of this.remoteConsumers.values()) {
      const volume = getRemoteConsumerVolume(record.activeChannelIds, this.mixSettings);

      if (record.gainNode) {
        record.gainNode.gain.value = volume;
        record.audioElement.volume = 1;
      } else {
        record.audioElement.volume = volume;
      }

      if (record.panNode) {
        const pan = getRemoteConsumerPan(record.activeChannelIds, this.mixSettings);
        record.panNode.pan.value = pan;
      }
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
      const audioElement = document.createElement("audio");
      const stream = new MediaStream([consumer.track]);

      audioElement.autoplay = true;
      audioElement.setAttribute("playsinline", "true");
      audioElement.srcObject = stream;
      audioElement.style.display = "none";
      document.body.appendChild(audioElement);

      const record: RemoteConsumerRecord = {
        activeChannelIds: payload.activeChannelIds,
        audioElement,
        consumer,
        producerUserId: payload.producerUserId,
        producerUsername: payload.producerUsername,
      };

      if (this.audioContext) {
        try {
          const sourceNode = this.audioContext.createMediaElementSource(audioElement);
          const gainNode = this.audioContext.createGain();
          const analyserNode = this.audioContext.createAnalyser();
          analyserNode.fftSize = 256;
          analyserNode.smoothingTimeConstant = 0.3;
          sourceNode.connect(gainNode);
          gainNode.connect(analyserNode);

          if (typeof StereoPannerNode !== "undefined") {
            const panNode = this.audioContext.createStereoPanner();
            analyserNode.connect(panNode);
            panNode.connect(this.audioContext.destination);
            record.panNode = panNode;
          } else {
            analyserNode.connect(this.audioContext.destination);
          }

          record.sourceNode = sourceNode;
          record.gainNode = gainNode;
          record.analyserNode = analyserNode;
        } catch {
          // Fall back to audioElement.volume if Web Audio routing fails
        }
      }

      this.remoteConsumers.set(payload.consumerId, record);
      this.updateMix(this.mixSettings);
      this.emitRemoteTalkers();
      this.startRemoteLevelMeter();
      await this.options.realtimeClient.resumeMediaConsumer(payload.consumerId);
      void audioElement.play().catch(() => undefined);
    } catch (error) {
      this.options.onError?.(
        error instanceof Error ? error : new Error("Unable to consume CueCommX remote audio."),
      );
    }
  }

  private async ensureLocalCapture(inputDeviceId?: string): Promise<MediaStreamTrack> {
    const capabilityError = getAudioCaptureCapabilityError(navigator.mediaDevices, {
      hostname: typeof window === "undefined" ? undefined : window.location.hostname,
      isSecureContext: typeof window === "undefined" ? undefined : window.isSecureContext,
    });

    if (capabilityError) {
      throw new Error(capabilityError);
    }

    const AudioContextCtor = getAudioContextConstructor();

    if (!AudioContextCtor) {
      throw new Error("This browser does not expose AudioContext for CueCommX monitoring.");
    }

    if (!this.audioContext) {
      this.audioContext = new AudioContextCtor();
    }

    await this.audioContext.resume();

    if (this.localStream && this.currentInputDeviceId === inputDeviceId) {
      return this.getLocalTrack();
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: this.audioProcessing.autoGainControl,
        channelCount: 1,
        deviceId: inputDeviceId ? { exact: inputDeviceId } : undefined,
        echoCancellation: this.audioProcessing.echoCancellation,
        noiseSuppression: this.audioProcessing.noiseSuppression,
      },
    });
    const [track] = stream.getAudioTracks();

    if (!track) {
      throw new Error("CueCommX did not receive an audio track from this browser.");
    }

    this.attachLocalStream(stream);
    this.currentInputDeviceId = inputDeviceId;
    await this.refreshInputDevices();

    return track;
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

  private getLocalTrack(): MediaStreamTrack {
    const [track] = this.localStream?.getAudioTracks() ?? [];

    if (!track) {
      throw new Error("CueCommX local audio track is not available.");
    }

    return track;
  }

  private removeRemoteConsumer(consumerId: string): void {
    const record = this.remoteConsumers.get(consumerId);

    if (!record) {
      return;
    }

    record.panNode?.disconnect();
    record.gainNode?.disconnect();
    record.sourceNode?.disconnect();
    record.consumer.close();
    record.audioElement.pause();
    record.audioElement.removeAttribute("src");
    record.audioElement.srcObject = null;
    record.audioElement.remove();
    this.remoteConsumers.delete(consumerId);
    this.emitRemoteTalkers();
  }

  private async refreshInputDevices(): Promise<void> {
    if (!canEnumerateInputDevices(navigator.mediaDevices)) {
      this.options.onInputDevicesChange?.([]);
      return;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices
      .filter((device) => device.kind === "audioinput")
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Input ${index + 1}`,
      }));

    this.options.onInputDevicesChange?.(audioInputs);
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
        this.options.onError?.(new Error(`CueCommX send transport entered ${state}.`));
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
        this.options.onError?.(new Error(`CueCommX receive transport entered ${state}.`));
      }
    });
  }

  private startQualityMonitor(): void {
    if (this.qualityTimer) {
      return;
    }

    this.qualityTimer = window.setInterval(() => {
      void this.collectQualityStats();
    }, 5_000);
  }

  private stopQualityMonitor(): void {
    if (!this.qualityTimer) {
      return;
    }

    window.clearInterval(this.qualityTimer);
    this.qualityTimer = undefined;
    this.options.onConnectionQualityChange?.(undefined);
  }

  private async collectQualityStats(): Promise<void> {
    const transport = this.sendTransport;

    if (!transport) {
      return;
    }

    try {
      const stats = await transport.getStats();
      const quality = extractConnectionQuality(stats);

      if (quality) {
        this.options.onConnectionQualityChange?.(quality);
        this.options.realtimeClient.reportConnectionQuality(quality);
      }
    } catch {
      // Stats collection may fail during transport teardown — ignore
    }
  }

  private startMeter(): void {
    if (!this.analyserNode || this.inputLevelTimer) {
      return;
    }

    const sampleBuffer = new Uint8Array(this.analyserNode.fftSize);

    this.inputLevelTimer = window.setInterval(() => {
      this.analyserNode?.getByteTimeDomainData(sampleBuffer);
      let sumSquares = 0;

      for (const sample of sampleBuffer) {
        const normalized = sample / 128 - 1;
        sumSquares += normalized * normalized;
      }

      const rms = Math.sqrt(sumSquares / sampleBuffer.length);
      this.options.onLocalLevelChange?.(Math.min(100, Math.round(rms * 180)));
    }, 120);
  }

  private stopLocalStream(): void {
    for (const track of this.localStream?.getTracks() ?? []) {
      track.stop();
    }

    this.localStream = undefined;
  }

  private stopMeter(): void {
    if (!this.inputLevelTimer) {
      return;
    }

    window.clearInterval(this.inputLevelTimer);
    this.inputLevelTimer = undefined;
  }

  private startRemoteLevelMeter(): void {
    if (this.remoteLevelTimer) {
      return;
    }

    this.remoteLevelTimer = window.setInterval(() => {
      const channelLevels: Record<string, number> = {};

      for (const record of this.remoteConsumers.values()) {
        if (!record.analyserNode) {
          continue;
        }

        const buffer = new Uint8Array(record.analyserNode.fftSize);
        record.analyserNode.getByteTimeDomainData(buffer);
        let sumSquares = 0;

        for (const sample of buffer) {
          const normalized = sample / 128 - 1;
          sumSquares += normalized * normalized;
        }

        const rms = Math.sqrt(sumSquares / buffer.length);
        const level = Math.min(100, Math.round(rms * 180));

        for (const channelId of record.activeChannelIds) {
          channelLevels[channelId] = Math.max(channelLevels[channelId] ?? 0, level);
        }
      }

      this.options.onRemoteLevelsChange?.(channelLevels);
    }, 150);
  }

  private stopRemoteLevelMeter(): void {
    if (!this.remoteLevelTimer) {
      return;
    }

    window.clearInterval(this.remoteLevelTimer);
    this.remoteLevelTimer = undefined;
  }

  private attachLocalStream(stream: MediaStream): void {
    this.stopMeter();
    this.localAudioSource?.disconnect();

    if (this.sidetoneGainNode) {
      this.sidetoneGainNode.disconnect();
      this.sidetoneGainNode = null;
    }

    this.stopLocalStream();
    this.localStream = stream;

    if (!this.audioContext) {
      throw new Error("CueCommX audio context is not ready.");
    }

    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.localAudioSource = this.audioContext.createMediaStreamSource(stream);
    this.localAudioSource.connect(this.analyserNode);

    if (this.sidetoneEnabled) {
      this.sidetoneGainNode = this.audioContext.createGain();
      this.sidetoneGainNode.gain.value = this.sidetoneLevel;
      this.localAudioSource.connect(this.sidetoneGainNode);
      this.sidetoneGainNode.connect(this.audioContext.destination);
    }

    this.startMeter();
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

export function createWebMediaController(
  options: WebMediaControllerOptions,
): WebMediaController {
  return new WebMediaController(options);
}
