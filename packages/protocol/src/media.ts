import { z } from "zod";

const MediaParameterValueSchema = z.union([
  z.boolean(),
  z.null(),
  z.number(),
  z.string(),
]);

export const MediaRequestIdSchema = z.string().trim().min(1);
export type MediaRequestId = z.infer<typeof MediaRequestIdSchema>;

export const MediaKindSchema = z.literal("audio");
export type MediaKind = z.infer<typeof MediaKindSchema>;

export const MediaTransportDirectionSchema = z.enum(["send", "recv"]);
export type MediaTransportDirection = z.infer<typeof MediaTransportDirectionSchema>;

export const MediaParameterMapSchema = z.record(z.string(), MediaParameterValueSchema).default({});
export type MediaParameterMap = z.infer<typeof MediaParameterMapSchema>;

export const MediaTransportProtocolSchema = z.enum(["udp", "tcp"]);
export type MediaTransportProtocol = z.infer<typeof MediaTransportProtocolSchema>;

export const MediaIceCandidateTypeSchema = z.literal("host");
export type MediaIceCandidateType = z.infer<typeof MediaIceCandidateTypeSchema>;

export const MediaIceCandidateTcpTypeSchema = z.literal("passive");
export type MediaIceCandidateTcpType = z.infer<typeof MediaIceCandidateTcpTypeSchema>;

export const MediaFingerprintAlgorithmSchema = z.enum([
  "sha-1",
  "sha-224",
  "sha-256",
  "sha-384",
  "sha-512",
]);
export type MediaFingerprintAlgorithm = z.infer<typeof MediaFingerprintAlgorithmSchema>;

export const MediaRtpHeaderExtensionUriSchema = z.enum([
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
export type MediaRtpHeaderExtensionUri = z.infer<typeof MediaRtpHeaderExtensionUriSchema>;

export const MediaRtcpFeedbackSchema = z.object({
  parameter: z.string().optional(),
  type: z.string().min(1),
});
export type MediaRtcpFeedback = z.infer<typeof MediaRtcpFeedbackSchema>;

export const MediaIceCandidateSchema = z
  .object({
    address: z.string().min(1).optional(),
    foundation: z.string().min(1),
    ip: z.string().min(1),
    port: z.number().int().positive(),
    priority: z.number().int(),
    protocol: MediaTransportProtocolSchema,
    tcpType: MediaIceCandidateTcpTypeSchema.optional(),
    type: MediaIceCandidateTypeSchema,
  })
  .passthrough();
export type MediaIceCandidate = z.infer<typeof MediaIceCandidateSchema>;

export const MediaIceParametersSchema = z
  .object({
    iceLite: z.boolean().optional(),
    password: z.string().min(1),
    usernameFragment: z.string().min(1),
  })
  .passthrough();
export type MediaIceParameters = z.infer<typeof MediaIceParametersSchema>;

export const MediaDtlsFingerprintSchema = z.object({
  algorithm: MediaFingerprintAlgorithmSchema,
  value: z.string().min(1),
});
export type MediaDtlsFingerprint = z.infer<typeof MediaDtlsFingerprintSchema>;

export const MediaDtlsParametersSchema = z
  .object({
    fingerprints: z.array(MediaDtlsFingerprintSchema).min(1),
    role: z.enum(["auto", "client", "server"]).optional(),
  })
  .passthrough();
export type MediaDtlsParameters = z.infer<typeof MediaDtlsParametersSchema>;

export const MediaRtpCodecCapabilitySchema = z
  .object({
    channels: z.number().int().positive().optional(),
    clockRate: z.number().int().positive(),
    kind: MediaKindSchema,
    mimeType: z.string().min(1),
    parameters: MediaParameterMapSchema.optional(),
    preferredPayloadType: z.number().int().nonnegative().optional(),
    rtcpFeedback: z.array(MediaRtcpFeedbackSchema).default([]),
  })
  .passthrough();
export type MediaRtpCodecCapability = z.infer<typeof MediaRtpCodecCapabilitySchema>;

export const MediaRtpHeaderExtensionSchema = z
  .object({
    direction: z.enum(["sendrecv", "sendonly", "recvonly", "inactive"]).optional(),
    encrypt: z.boolean().optional(),
    id: z.number().int().positive().optional(),
    kind: MediaKindSchema.optional(),
    parameters: MediaParameterMapSchema.optional(),
    preferredEncrypt: z.boolean().optional(),
    preferredId: z.number().int().positive().optional(),
    uri: MediaRtpHeaderExtensionUriSchema,
  })
  .passthrough();
export type MediaRtpHeaderExtension = z.infer<typeof MediaRtpHeaderExtensionSchema>;

export const MediaRtpCapabilitiesSchema = z
  .object({
    codecs: z.array(MediaRtpCodecCapabilitySchema),
    headerExtensions: z.array(MediaRtpHeaderExtensionSchema).default([]),
  })
  .passthrough();
export type MediaRtpCapabilities = z.infer<typeof MediaRtpCapabilitiesSchema>;

export const MediaRtpHeaderExtensionParametersSchema = z
  .object({
    encrypt: z.boolean().optional(),
    id: z.number().int().positive(),
    parameters: MediaParameterMapSchema.optional(),
    uri: MediaRtpHeaderExtensionUriSchema,
  })
  .passthrough();
export type MediaRtpHeaderExtensionParameters = z.infer<
  typeof MediaRtpHeaderExtensionParametersSchema
>;

export const MediaRtpCodecParametersSchema = z
  .object({
    channels: z.number().int().positive().optional(),
    clockRate: z.number().int().positive(),
    mimeType: z.string().min(1),
    parameters: MediaParameterMapSchema.optional(),
    payloadType: z.number().int().nonnegative(),
    rtcpFeedback: z.array(MediaRtcpFeedbackSchema).default([]),
  })
  .passthrough();
export type MediaRtpCodecParameters = z.infer<typeof MediaRtpCodecParametersSchema>;

export const MediaRtpEncodingParametersSchema = z
  .object({
    codecPayloadType: z.number().int().nonnegative().optional(),
    dtx: z.boolean().optional(),
    maxBitrate: z.number().int().nonnegative().optional(),
    rid: z.string().min(1).optional(),
    scalabilityMode: z.string().min(1).optional(),
    ssrc: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type MediaRtpEncodingParameters = z.infer<typeof MediaRtpEncodingParametersSchema>;

export const MediaRtcpParametersSchema = z
  .object({
    cname: z.string().min(1).optional(),
    mux: z.boolean().optional(),
    reducedSize: z.boolean().optional(),
  })
  .passthrough();
export type MediaRtcpParameters = z.infer<typeof MediaRtcpParametersSchema>;

export const MediaRtpParametersSchema = z
  .object({
    codecs: z.array(MediaRtpCodecParametersSchema).min(1),
    encodings: z.array(MediaRtpEncodingParametersSchema).min(1),
    headerExtensions: z.array(MediaRtpHeaderExtensionParametersSchema).default([]),
    mid: z.string().min(1).optional(),
    rtcp: MediaRtcpParametersSchema.optional(),
  })
  .passthrough();
export type MediaRtpParameters = z.infer<typeof MediaRtpParametersSchema>;

export const MediaTransportOptionsSchema = z
  .object({
    direction: MediaTransportDirectionSchema,
    dtlsParameters: MediaDtlsParametersSchema,
    iceCandidates: z.array(MediaIceCandidateSchema),
    iceParameters: MediaIceParametersSchema,
    id: z.string().min(1),
  })
  .passthrough();
export type MediaTransportOptions = z.infer<typeof MediaTransportOptionsSchema>;

export const MediaCapabilitiesRequestMessageSchema = z.object({
  type: z.literal("media:capabilities:get"),
  payload: z.object({
    requestId: MediaRequestIdSchema,
  }),
});
export type MediaCapabilitiesRequestMessage = z.infer<typeof MediaCapabilitiesRequestMessageSchema>;

export const MediaCapabilitiesMessageSchema = z.object({
  type: z.literal("media:capabilities"),
  payload: z.object({
    requestId: MediaRequestIdSchema,
    routerRtpCapabilities: MediaRtpCapabilitiesSchema,
  }),
});
export type MediaCapabilitiesMessage = z.infer<typeof MediaCapabilitiesMessageSchema>;

export const MediaTransportCreateRequestMessageSchema = z.object({
  type: z.literal("media:transport:create"),
  payload: z.object({
    direction: MediaTransportDirectionSchema,
    requestId: MediaRequestIdSchema,
  }),
});
export type MediaTransportCreateRequestMessage = z.infer<
  typeof MediaTransportCreateRequestMessageSchema
>;

export const MediaTransportCreatedMessageSchema = z.object({
  type: z.literal("media:transport:created"),
  payload: z.object({
    requestId: MediaRequestIdSchema,
    transport: MediaTransportOptionsSchema,
  }),
});
export type MediaTransportCreatedMessage = z.infer<typeof MediaTransportCreatedMessageSchema>;

export const MediaTransportConnectRequestMessageSchema = z.object({
  type: z.literal("media:transport:connect"),
  payload: z.object({
    dtlsParameters: MediaDtlsParametersSchema,
    requestId: MediaRequestIdSchema,
    transportId: z.string().min(1),
  }),
});
export type MediaTransportConnectRequestMessage = z.infer<
  typeof MediaTransportConnectRequestMessageSchema
>;

export const MediaTransportConnectedMessageSchema = z.object({
  type: z.literal("media:transport:connected"),
  payload: z.object({
    requestId: MediaRequestIdSchema,
    transportId: z.string().min(1),
  }),
});
export type MediaTransportConnectedMessage = z.infer<typeof MediaTransportConnectedMessageSchema>;

export const MediaProducerCreateRequestMessageSchema = z.object({
  type: z.literal("media:producer:create"),
  payload: z.object({
    kind: MediaKindSchema,
    requestId: MediaRequestIdSchema,
    rtpParameters: MediaRtpParametersSchema,
    transportId: z.string().min(1),
  }),
});
export type MediaProducerCreateRequestMessage = z.infer<
  typeof MediaProducerCreateRequestMessageSchema
>;

export const MediaProducerCreatedMessageSchema = z.object({
  type: z.literal("media:producer:created"),
  payload: z.object({
    producerId: z.string().min(1),
    requestId: MediaRequestIdSchema,
  }),
});
export type MediaProducerCreatedMessage = z.infer<typeof MediaProducerCreatedMessageSchema>;

export const MediaProducerCloseRequestMessageSchema = z.object({
  type: z.literal("media:producer:close"),
  payload: z.object({
    producerId: z.string().min(1),
    requestId: MediaRequestIdSchema,
  }),
});
export type MediaProducerCloseRequestMessage = z.infer<
  typeof MediaProducerCloseRequestMessageSchema
>;

export const MediaProducerClosedMessageSchema = z.object({
  type: z.literal("media:producer:closed"),
  payload: z.object({
    producerId: z.string().min(1),
    requestId: MediaRequestIdSchema,
  }),
});
export type MediaProducerClosedMessage = z.infer<typeof MediaProducerClosedMessageSchema>;

export const MediaConsumerAvailableMessageSchema = z.object({
  type: z.literal("media:consumer:available"),
  payload: z.object({
    activeChannelIds: z.array(z.string().min(1)),
    consumerId: z.string().min(1),
    kind: MediaKindSchema,
    producerId: z.string().min(1),
    producerUserId: z.string().min(1),
    producerUsername: z.string().min(1),
    rtpParameters: MediaRtpParametersSchema,
  }),
});
export type MediaConsumerAvailableMessage = z.infer<typeof MediaConsumerAvailableMessageSchema>;

export const MediaConsumerStateMessageSchema = z.object({
  type: z.literal("media:consumer:state"),
  payload: z.object({
    activeChannelIds: z.array(z.string().min(1)),
    consumerId: z.string().min(1),
    producerUserId: z.string().min(1),
    producerUsername: z.string().min(1),
  }),
});
export type MediaConsumerStateMessage = z.infer<typeof MediaConsumerStateMessageSchema>;

export const MediaConsumerClosedMessageSchema = z.object({
  type: z.literal("media:consumer:closed"),
  payload: z.object({
    consumerId: z.string().min(1),
  }),
});
export type MediaConsumerClosedMessage = z.infer<typeof MediaConsumerClosedMessageSchema>;

export const MediaConsumerResumeRequestMessageSchema = z.object({
  type: z.literal("media:consumer:resume"),
  payload: z.object({
    consumerId: z.string().min(1),
    requestId: MediaRequestIdSchema,
  }),
});
export type MediaConsumerResumeRequestMessage = z.infer<
  typeof MediaConsumerResumeRequestMessageSchema
>;

export const MediaConsumerResumedMessageSchema = z.object({
  type: z.literal("media:consumer:resumed"),
  payload: z.object({
    consumerId: z.string().min(1),
    requestId: MediaRequestIdSchema,
  }),
});
export type MediaConsumerResumedMessage = z.infer<typeof MediaConsumerResumedMessageSchema>;
