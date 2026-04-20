import type { MediaRtpCapabilities, MediaTransportOptions } from "@cuecommx/protocol";
import type { RtpParameters as MediasoupRtpParameters } from "mediasoup-client/types";
import { describe, expect, it } from "vitest";

import {
  canEnumerateInputDevices,
  clampVolume,
  computeQualityGrade,
  extractConnectionQuality,
  getAudioCaptureCapabilityError,
  getRemoteConsumerVolume,
  toMediasoupRtpCapabilities,
  toMediasoupTransportOptions,
  toProtocolParameterMap,
  toProtocolRtpParameters,
  type MixSettings,
} from "./web-media-controller.js";

describe("clampVolume", () => {
  it("limits mix values to the supported 0-1 range", () => {
    expect(clampVolume(-0.25)).toBe(0);
    expect(clampVolume(0.5)).toBe(0.5);
    expect(clampVolume(1.5)).toBe(1);
  });
});

describe("browser audio capability helpers", () => {
  it("reports a secure-context requirement when getUserMedia is unavailable on remote origins", () => {
    expect(
      getAudioCaptureCapabilityError(undefined, {
        hostname: "192.168.0.25",
        isSecureContext: false,
      }),
    ).toContain("requires HTTPS");
  });

  it("allows audio capture without enumerateDevices and detects optional device listing support", () => {
    expect(
      getAudioCaptureCapabilityError({
        getUserMedia: async () => new MediaStream(),
      } as Pick<MediaDevices, "getUserMedia" | "enumerateDevices">),
    ).toBeUndefined();
    expect(
      canEnumerateInputDevices({
        enumerateDevices: async () => [],
      } as Pick<MediaDevices, "enumerateDevices">),
    ).toBe(true);
    expect(canEnumerateInputDevices(undefined)).toBe(false);
  });
});

describe("getRemoteConsumerVolume", () => {
  it("uses the loudest routed listen channel and master volume", () => {
    const settings: MixSettings = {
      activeListenChannelIds: ["ch-audio", "ch-stage"],
      activeTalkerChannelIds: [],
      channelPans: {},
      channelPriorities: {},
      channelVolumes: {
        "ch-audio": 0.4,
        "ch-stage": 0.8,
      },
      duckingEnabled: false,
      duckLevel: 0.3,
      masterVolume: 0.5,
    };

    expect(getRemoteConsumerVolume(["ch-audio", "ch-stage"], settings)).toBe(0.4);
    expect(getRemoteConsumerVolume(["ch-video"], settings)).toBe(0);
  });

  it("ducks lower-priority channels when a higher-priority channel has active talkers", () => {
    const settings: MixSettings = {
      activeListenChannelIds: ["ch-audio", "ch-production"],
      activeTalkerChannelIds: ["ch-production"],
      channelPans: {},
      channelPriorities: {
        "ch-audio": 5,
        "ch-production": 8,
      },
      channelVolumes: {
        "ch-audio": 1,
        "ch-production": 1,
      },
      duckingEnabled: true,
      duckLevel: 0.3,
      masterVolume: 1,
    };

    // ch-audio (priority 5) should be ducked because ch-production (priority 8) is active
    expect(getRemoteConsumerVolume(["ch-audio"], settings)).toBeCloseTo(0.3, 5);

    // ch-production (priority 8) should NOT be ducked — it is the highest priority active
    expect(getRemoteConsumerVolume(["ch-production"], settings)).toBe(1);
  });

  it("does not duck when ducking is disabled", () => {
    const settings: MixSettings = {
      activeListenChannelIds: ["ch-audio", "ch-production"],
      activeTalkerChannelIds: ["ch-production"],
      channelPans: {},
      channelPriorities: {
        "ch-audio": 5,
        "ch-production": 8,
      },
      channelVolumes: {
        "ch-audio": 1,
        "ch-production": 1,
      },
      duckingEnabled: false,
      duckLevel: 0.3,
      masterVolume: 1,
    };

    expect(getRemoteConsumerVolume(["ch-audio"], settings)).toBe(1);
  });

  it("does not duck channels at the same priority as the active talker", () => {
    const settings: MixSettings = {
      activeListenChannelIds: ["ch-audio", "ch-stage"],
      activeTalkerChannelIds: ["ch-audio"],
      channelPans: {},
      channelPriorities: {
        "ch-audio": 5,
        "ch-stage": 5,
      },
      channelVolumes: {
        "ch-audio": 1,
        "ch-stage": 1,
      },
      duckingEnabled: true,
      duckLevel: 0.3,
      masterVolume: 1,
    };

    // Same priority — no ducking
    expect(getRemoteConsumerVolume(["ch-stage"], settings)).toBe(1);
  });

  it("does not duck when no channels have active talkers", () => {
    const settings: MixSettings = {
      activeListenChannelIds: ["ch-audio"],
      activeTalkerChannelIds: [],
      channelPans: {},
      channelPriorities: { "ch-audio": 5 },
      channelVolumes: { "ch-audio": 0.8 },
      duckingEnabled: true,
      duckLevel: 0.3,
      masterVolume: 1,
    };

    expect(getRemoteConsumerVolume(["ch-audio"], settings)).toBe(0.8);
  });
});

describe("toProtocolParameterMap", () => {
  it("drops unsupported parameter values and omits empty maps", () => {
    expect(
      toProtocolParameterMap({
        enabled: true,
        label: "cuecommx",
        nested: {
          ignored: true,
        },
        unset: undefined,
      }),
    ).toEqual({
      enabled: true,
      label: "cuecommx",
    });
    expect(toProtocolParameterMap({ nested: { ignored: true } })).toBeUndefined();
  });
});

describe("toProtocolRtpParameters", () => {
  it("keeps supported RTP header extensions and normalizes primitive parameters", () => {
    const rtpParameters = {
      codecs: [
        {
          mimeType: "audio/opus",
          payloadType: 111,
          clockRate: 48_000,
          channels: 2,
          parameters: {
            useinbandfec: 1,
            extra: {
              ignored: true,
            },
          },
          rtcpFeedback: [],
        },
      ],
      encodings: [
        {
          ssrc: 12345,
        },
      ],
      headerExtensions: [
        {
          encrypt: false,
          id: 1,
          parameters: {
            mid: "0",
          },
          uri: "urn:ietf:params:rtp-hdrext:sdes:mid",
        },
        {
          encrypt: false,
          id: 99,
          parameters: {},
          uri: "urn:cuecommx:unsupported",
        },
      ],
      mid: "0",
      rtcp: {
        cname: "cuecommx",
        mux: true,
        reducedSize: true,
      },
    } as unknown as MediasoupRtpParameters;

    expect(toProtocolRtpParameters(rtpParameters)).toMatchObject({
      codecs: [
        {
          mimeType: "audio/opus",
          parameters: {
            useinbandfec: 1,
          },
        },
      ],
      headerExtensions: [
        {
          id: 1,
          uri: "urn:ietf:params:rtp-hdrext:sdes:mid",
        },
      ],
    });
  });
});

describe("mediasoup option mappers", () => {
  it("converts router capabilities and transport options for mediasoup-client", () => {
    const routerCapabilities: MediaRtpCapabilities = {
      codecs: [
        {
          kind: "audio",
          mimeType: "audio/opus",
          preferredPayloadType: 111,
          clockRate: 48_000,
          channels: 2,
          parameters: {
            useinbandfec: 1,
          },
          rtcpFeedback: [],
        },
      ],
      headerExtensions: [
        {
          direction: "sendrecv",
          kind: "audio",
          preferredEncrypt: false,
          preferredId: 1,
          uri: "urn:ietf:params:rtp-hdrext:sdes:mid",
        },
      ],
    };
    const transportOptions: MediaTransportOptions = {
      direction: "send",
      id: "transport-1",
      iceCandidates: [
        {
          foundation: "foundation",
          ip: "10.0.0.25",
          address: "10.0.0.25",
          port: 40_000,
          priority: 1,
          protocol: "udp",
          type: "host",
        },
      ],
      iceParameters: {
        iceLite: true,
        password: "password",
        usernameFragment: "ufrag",
      },
      dtlsParameters: {
        fingerprints: [
          {
            algorithm: "sha-256",
            value: "AA:BB:CC",
          },
        ],
        role: "auto",
      },
    };

    expect(toMediasoupRtpCapabilities(routerCapabilities)).toMatchObject({
      codecs: [
        {
          mimeType: "audio/opus",
          preferredPayloadType: 111,
        },
      ],
      headerExtensions: [
        {
          preferredId: 1,
          uri: "urn:ietf:params:rtp-hdrext:sdes:mid",
        },
      ],
    });
    expect(toMediasoupTransportOptions(transportOptions)).toMatchObject({
      id: "transport-1",
      iceCandidates: [
        {
          address: "10.0.0.25",
          ip: "10.0.0.25",
          port: 40_000,
        },
      ],
    });
  });

  it("rejects incomplete router capabilities from the server", () => {
    expect(() =>
      toMediasoupRtpCapabilities({
        codecs: [
          {
            kind: "audio",
            mimeType: "audio/opus",
            clockRate: 48_000,
            channels: 2,
            parameters: {},
            rtcpFeedback: [],
          },
        ],
        headerExtensions: [],
      }),
    ).toThrow("preferred payload type");

    expect(() =>
      toMediasoupRtpCapabilities({
        codecs: [
          {
            kind: "audio",
            mimeType: "audio/opus",
            preferredPayloadType: 111,
            clockRate: 48_000,
            channels: 2,
            parameters: {},
            rtcpFeedback: [],
          },
        ],
        headerExtensions: [
          {
            uri: "urn:ietf:params:rtp-hdrext:sdes:mid",
          },
        ],
      }),
    ).toThrow("preferred header extension id");
  });
});

describe("computeQualityGrade", () => {
  it("classifies excellent conditions", () => {
    expect(computeQualityGrade(10, 0.1, 2)).toBe("excellent");
  });

  it("classifies good conditions", () => {
    expect(computeQualityGrade(40, 0.8, 10)).toBe("good");
  });

  it("classifies fair conditions", () => {
    expect(computeQualityGrade(80, 3, 25)).toBe("fair");
  });

  it("classifies poor conditions", () => {
    expect(computeQualityGrade(150, 8, 50)).toBe("poor");
  });

  it("downgrades when any metric exceeds threshold", () => {
    // RTT excellent but loss is fair-range
    expect(computeQualityGrade(10, 3, 2)).toBe("fair");
    // All metrics good but jitter is poor-range
    expect(computeQualityGrade(20, 0.5, 40)).toBe("poor");
  });
});

describe("extractConnectionQuality", () => {
  function createStatsReport(entries: Record<string, unknown>[]): RTCStatsReport {
    const map = new Map<string, unknown>();

    for (const entry of entries) {
      map.set(entry.id as string, entry);
    }

    return map as unknown as RTCStatsReport;
  }

  it("extracts quality from a stats report with candidate-pair", () => {
    const stats = createStatsReport([
      {
        id: "CP1",
        type: "candidate-pair",
        nominated: true,
        currentRoundTripTime: 0.025,
      },
      {
        id: "OT1",
        type: "outbound-rtp",
        packetsSent: 1000,
        nackCount: 5,
      },
      {
        id: "RI1",
        type: "remote-inbound-rtp",
        jitter: 0.008,
      },
    ]);

    const quality = extractConnectionQuality(stats);
    expect(quality).toBeDefined();
    expect(quality!.roundTripTimeMs).toBe(25);
    expect(quality!.packetLossPercent).toBeCloseTo(0.5, 1);
    expect(quality!.jitterMs).toBe(8);
    expect(quality!.grade).toBe("good");
  });

  it("returns undefined when no nominated candidate-pair exists", () => {
    const stats = createStatsReport([
      {
        id: "CP1",
        type: "candidate-pair",
        nominated: false,
        currentRoundTripTime: 0.05,
      },
    ]);

    expect(extractConnectionQuality(stats)).toBeUndefined();
  });

  it("handles missing jitter and loss gracefully", () => {
    const stats = createStatsReport([
      {
        id: "CP1",
        type: "candidate-pair",
        nominated: true,
        currentRoundTripTime: 0.01,
      },
    ]);

    const quality = extractConnectionQuality(stats);
    expect(quality).toBeDefined();
    expect(quality!.packetLossPercent).toBe(0);
    expect(quality!.jitterMs).toBe(0);
    expect(quality!.grade).toBe("excellent");
  });
});
