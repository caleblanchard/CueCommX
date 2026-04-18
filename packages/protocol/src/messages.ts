import { z } from "zod";

import { AdminDashboardSnapshotSchema, ConnectionQualitySchema, PreflightStatusSchema } from "./admin.js";
import { AuthCredentialsSchema } from "./auth.js";
import {
  MediaCapabilitiesMessageSchema,
  MediaCapabilitiesRequestMessageSchema,
  MediaConsumerAvailableMessageSchema,
  MediaConsumerClosedMessageSchema,
  MediaConsumerResumeRequestMessageSchema,
  MediaConsumerResumedMessageSchema,
  MediaConsumerStateMessageSchema,
  MediaProducerCloseRequestMessageSchema,
  MediaProducerClosedMessageSchema,
  MediaProducerCreateRequestMessageSchema,
  MediaProducerCreatedMessageSchema,
  MediaTransportConnectRequestMessageSchema,
  MediaTransportConnectedMessageSchema,
  MediaTransportCreateRequestMessageSchema,
  MediaTransportCreatedMessageSchema,
} from "./media.js";
import {
  ChannelInfoSchema,
  OperatorStateSchema,
  PROTOCOL_VERSION,
  UserInfoSchema,
} from "./models.js";
import { GroupInfoSchema } from "./groups.js";

export const AuthRequestSchema = z.object({
  type: z.literal("auth"),
  payload: AuthCredentialsSchema,
});
export type AuthRequest = z.infer<typeof AuthRequestSchema>;

export const AuthResponseSchema = z.object({
  type: z.literal("auth:result"),
  payload: z.object({
    success: z.boolean(),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    user: UserInfoSchema.optional(),
    channels: z.array(ChannelInfoSchema).optional(),
    groups: z.array(GroupInfoSchema).optional(),
    error: z.string().min(1).optional(),
  }),
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const SessionAuthenticateMessageSchema = z.object({
  type: z.literal("session:authenticate"),
  payload: z.object({
    sessionToken: z.string().min(1),
  }),
});
export type SessionAuthenticateMessage = z.infer<typeof SessionAuthenticateMessageSchema>;

export const SessionReadyMessageSchema = z.object({
  type: z.literal("session:ready"),
  payload: z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    connectedUsers: z.number().int().nonnegative(),
    user: UserInfoSchema,
    channels: z.array(ChannelInfoSchema),
    groups: z.array(GroupInfoSchema).optional().default([]),
    operatorState: OperatorStateSchema,
  }),
});
export type SessionReadyMessage = z.infer<typeof SessionReadyMessageSchema>;

export const PresenceUpdateMessageSchema = z.object({
  type: z.literal("presence:update"),
  payload: z.object({
    connectedUsers: z.number().int().nonnegative(),
  }),
});
export type PresenceUpdateMessage = z.infer<typeof PresenceUpdateMessageSchema>;

export const OperatorStateMessageSchema = z.object({
  type: z.literal("operator-state"),
  payload: OperatorStateSchema,
});
export type OperatorStateMessage = z.infer<typeof OperatorStateMessageSchema>;

export const SignalErrorMessageSchema = z.object({
  type: z.literal("signal:error"),
  payload: z.object({
    code: z.string().min(1).optional(),
    message: z.string().min(1),
    requestId: z.string().min(1).optional(),
  }),
});
export type SignalErrorMessage = z.infer<typeof SignalErrorMessageSchema>;

export const AdminDashboardMessageSchema = z.object({
  type: z.literal("admin:dashboard"),
  payload: AdminDashboardSnapshotSchema,
});
export type AdminDashboardMessage = z.infer<typeof AdminDashboardMessageSchema>;

export const ForceMutedMessageSchema = z.object({
  type: z.literal("force-muted"),
  payload: z.object({
    reason: z.enum(["user", "channel"]),
    channelId: z.string().min(1).optional(),
  }),
});
export type ForceMutedMessage = z.infer<typeof ForceMutedMessageSchema>;

export const QualityReportMessageSchema = z.object({
  type: z.literal("quality:report"),
  payload: ConnectionQualitySchema,
});
export type QualityReportMessage = z.infer<typeof QualityReportMessageSchema>;

export const PreflightResultMessageSchema = z.object({
  type: z.literal("preflight:result"),
  payload: z.object({
    status: PreflightStatusSchema,
  }),
});
export type PreflightResultMessage = z.infer<typeof PreflightResultMessageSchema>;

// --- All-Page messages ---

export const AllPageStartMessageSchema = z.object({
  type: z.literal("allpage:start"),
  payload: z.object({}),
});
export type AllPageStartMessage = z.infer<typeof AllPageStartMessageSchema>;

export const AllPageStopMessageSchema = z.object({
  type: z.literal("allpage:stop"),
  payload: z.object({}),
});
export type AllPageStopMessage = z.infer<typeof AllPageStopMessageSchema>;

export const AllPageActiveMessageSchema = z.object({
  type: z.literal("allpage:active"),
  payload: z.object({
    userId: z.string().min(1),
    username: z.string().min(1),
  }),
});
export type AllPageActiveMessage = z.infer<typeof AllPageActiveMessageSchema>;

export const AllPageInactiveMessageSchema = z.object({
  type: z.literal("allpage:inactive"),
  payload: z.object({}),
});
export type AllPageInactiveMessage = z.infer<typeof AllPageInactiveMessageSchema>;

// --- Call Signaling messages ---

export const CallSignalTypeSchema = z.enum(["call", "standby", "go"]);
export type CallSignalType = z.infer<typeof CallSignalTypeSchema>;

export const SignalSendMessageSchema = z.object({
  type: z.literal("signal:send"),
  payload: z.object({
    signalType: CallSignalTypeSchema,
    targetChannelId: z.string().min(1).optional(),
    targetUserId: z.string().min(1).optional(),
  }),
});
export type SignalSendMessage = z.infer<typeof SignalSendMessageSchema>;

export const SignalAcknowledgeMessageSchema = z.object({
  type: z.literal("signal:ack"),
  payload: z.object({
    signalId: z.string().min(1),
  }),
});
export type SignalAcknowledgeMessage = z.infer<typeof SignalAcknowledgeMessageSchema>;

export const SignalReceivedMessageSchema = z.object({
  type: z.literal("signal:incoming"),
  payload: z.object({
    signalId: z.string().min(1),
    signalType: CallSignalTypeSchema,
    fromUserId: z.string().min(1),
    fromUsername: z.string().min(1),
    targetChannelId: z.string().min(1).optional(),
  }),
});
export type SignalReceivedMessage = z.infer<typeof SignalReceivedMessageSchema>;

export const SignalClearedMessageSchema = z.object({
  type: z.literal("signal:cleared"),
  payload: z.object({
    signalId: z.string().min(1),
  }),
});
export type SignalClearedMessage = z.infer<typeof SignalClearedMessageSchema>;

// --- Direct Call messages ---

export const DirectCallRequestMessageSchema = z.object({
  type: z.literal("direct:request"),
  payload: z.object({
    targetUserId: z.string().min(1),
  }),
});
export type DirectCallRequestMessage = z.infer<typeof DirectCallRequestMessageSchema>;

export const DirectCallAcceptMessageSchema = z.object({
  type: z.literal("direct:accept"),
  payload: z.object({
    callId: z.string().min(1),
  }),
});
export type DirectCallAcceptMessage = z.infer<typeof DirectCallAcceptMessageSchema>;

export const DirectCallRejectMessageSchema = z.object({
  type: z.literal("direct:reject"),
  payload: z.object({
    callId: z.string().min(1),
  }),
});
export type DirectCallRejectMessage = z.infer<typeof DirectCallRejectMessageSchema>;

export const DirectCallEndMessageSchema = z.object({
  type: z.literal("direct:end"),
  payload: z.object({
    callId: z.string().min(1),
  }),
});
export type DirectCallEndMessage = z.infer<typeof DirectCallEndMessageSchema>;

export const DirectCallIncomingMessageSchema = z.object({
  type: z.literal("direct:incoming"),
  payload: z.object({
    callId: z.string().min(1),
    fromUserId: z.string().min(1),
    fromUsername: z.string().min(1),
  }),
});
export type DirectCallIncomingMessage = z.infer<typeof DirectCallIncomingMessageSchema>;

export const DirectCallActiveMessageSchema = z.object({
  type: z.literal("direct:active"),
  payload: z.object({
    callId: z.string().min(1),
    peerUserId: z.string().min(1),
    peerUsername: z.string().min(1),
  }),
});
export type DirectCallActiveMessage = z.infer<typeof DirectCallActiveMessageSchema>;

export const DirectCallEndedReasonSchema = z.enum(["rejected", "ended", "unavailable", "busy"]);
export type DirectCallEndedReason = z.infer<typeof DirectCallEndedReasonSchema>;

export const DirectCallEndedMessageSchema = z.object({
  type: z.literal("direct:ended"),
  payload: z.object({
    callId: z.string().min(1),
    reason: DirectCallEndedReasonSchema,
  }),
});
export type DirectCallEndedMessage = z.infer<typeof DirectCallEndedMessageSchema>;

export const OnlineUsersMessageSchema = z.object({
  type: z.literal("online:users"),
  payload: z.object({
    users: z.array(z.object({
      id: z.string().min(1),
      username: z.string().min(1),
    })),
  }),
});
export type OnlineUsersMessage = z.infer<typeof OnlineUsersMessageSchema>;

// --- Talk messages ---

export const TalkStartMessageSchema = z.object({
  type: z.literal("talk:start"),
  payload: z.object({
    channelIds: z.array(z.string().min(1)).min(1),
  }),
});
export type TalkStartMessage = z.infer<typeof TalkStartMessageSchema>;

export const TalkStopMessageSchema = z.object({
  type: z.literal("talk:stop"),
  payload: z.object({
    channelIds: z.array(z.string().min(1)).min(1),
  }),
});
export type TalkStopMessage = z.infer<typeof TalkStopMessageSchema>;

export const ListenToggleMessageSchema = z.object({
  type: z.literal("listen:toggle"),
  payload: z.object({
    channelId: z.string().min(1),
    listening: z.boolean(),
  }),
});
export type ListenToggleMessage = z.infer<typeof ListenToggleMessageSchema>;

// --- IFB (Interrupted Fold-Back) messages ---

export const IFBStartMessageSchema = z.object({
  type: z.literal("ifb:start"),
  payload: z.object({
    targetUserId: z.string().min(1),
  }),
});
export type IFBStartMessage = z.infer<typeof IFBStartMessageSchema>;

export const IFBStopMessageSchema = z.object({
  type: z.literal("ifb:stop"),
  payload: z.object({}),
});
export type IFBStopMessage = z.infer<typeof IFBStopMessageSchema>;

export const IFBActiveMessageSchema = z.object({
  type: z.literal("ifb:active"),
  payload: z.object({
    fromUserId: z.string().min(1),
    fromUsername: z.string().min(1),
    duckLevel: z.number().min(0).max(1),
  }),
});
export type IFBActiveMessage = z.infer<typeof IFBActiveMessageSchema>;

export const IFBInactiveMessageSchema = z.object({
  type: z.literal("ifb:inactive"),
  payload: z.object({}),
});
export type IFBInactiveMessage = z.infer<typeof IFBInactiveMessageSchema>;

export const ClientSignalingMessageSchema = z.discriminatedUnion("type", [
  AuthRequestSchema,
  SessionAuthenticateMessageSchema,
  TalkStartMessageSchema,
  TalkStopMessageSchema,
  ListenToggleMessageSchema,
  QualityReportMessageSchema,
  PreflightResultMessageSchema,
  AllPageStartMessageSchema,
  AllPageStopMessageSchema,
  SignalSendMessageSchema,
  SignalAcknowledgeMessageSchema,
  DirectCallRequestMessageSchema,
  DirectCallAcceptMessageSchema,
  DirectCallRejectMessageSchema,
  DirectCallEndMessageSchema,
  IFBStartMessageSchema,
  IFBStopMessageSchema,
  MediaCapabilitiesRequestMessageSchema,
  MediaTransportCreateRequestMessageSchema,
  MediaTransportConnectRequestMessageSchema,
  MediaProducerCreateRequestMessageSchema,
  MediaProducerCloseRequestMessageSchema,
  MediaConsumerResumeRequestMessageSchema,
]);
export type ClientSignalingMessage = z.infer<typeof ClientSignalingMessageSchema>;

export const ServerSignalingMessageSchema = z.discriminatedUnion("type", [
  AuthResponseSchema,
  SessionReadyMessageSchema,
  PresenceUpdateMessageSchema,
  OperatorStateMessageSchema,
  SignalErrorMessageSchema,
  AdminDashboardMessageSchema,
  ForceMutedMessageSchema,
  AllPageActiveMessageSchema,
  AllPageInactiveMessageSchema,
  SignalReceivedMessageSchema,
  SignalClearedMessageSchema,
  DirectCallIncomingMessageSchema,
  DirectCallActiveMessageSchema,
  DirectCallEndedMessageSchema,
  OnlineUsersMessageSchema,
  IFBActiveMessageSchema,
  IFBInactiveMessageSchema,
  MediaCapabilitiesMessageSchema,
  MediaTransportCreatedMessageSchema,
  MediaTransportConnectedMessageSchema,
  MediaProducerCreatedMessageSchema,
  MediaProducerClosedMessageSchema,
  MediaConsumerAvailableMessageSchema,
  MediaConsumerStateMessageSchema,
  MediaConsumerClosedMessageSchema,
  MediaConsumerResumedMessageSchema,
]);
export type ServerSignalingMessage = z.infer<typeof ServerSignalingMessageSchema>;

export const SignalingMessageSchema = z.discriminatedUnion("type", [
  AuthRequestSchema,
  AuthResponseSchema,
  SessionAuthenticateMessageSchema,
  SessionReadyMessageSchema,
  PresenceUpdateMessageSchema,
  OperatorStateMessageSchema,
  SignalErrorMessageSchema,
  AdminDashboardMessageSchema,
  ForceMutedMessageSchema,
  TalkStartMessageSchema,
  TalkStopMessageSchema,
  ListenToggleMessageSchema,
  QualityReportMessageSchema,
  PreflightResultMessageSchema,
  AllPageStartMessageSchema,
  AllPageStopMessageSchema,
  AllPageActiveMessageSchema,
  AllPageInactiveMessageSchema,
  SignalSendMessageSchema,
  SignalAcknowledgeMessageSchema,
  SignalReceivedMessageSchema,
  SignalClearedMessageSchema,
  DirectCallRequestMessageSchema,
  DirectCallAcceptMessageSchema,
  DirectCallRejectMessageSchema,
  DirectCallEndMessageSchema,
  DirectCallIncomingMessageSchema,
  DirectCallActiveMessageSchema,
  DirectCallEndedMessageSchema,
  OnlineUsersMessageSchema,
  IFBStartMessageSchema,
  IFBStopMessageSchema,
  IFBActiveMessageSchema,
  IFBInactiveMessageSchema,
  MediaCapabilitiesRequestMessageSchema,
  MediaCapabilitiesMessageSchema,
  MediaTransportCreateRequestMessageSchema,
  MediaTransportCreatedMessageSchema,
  MediaTransportConnectRequestMessageSchema,
  MediaTransportConnectedMessageSchema,
  MediaProducerCreateRequestMessageSchema,
  MediaProducerCreatedMessageSchema,
  MediaProducerCloseRequestMessageSchema,
  MediaProducerClosedMessageSchema,
  MediaConsumerAvailableMessageSchema,
  MediaConsumerStateMessageSchema,
  MediaConsumerClosedMessageSchema,
  MediaConsumerResumeRequestMessageSchema,
  MediaConsumerResumedMessageSchema,
]);
export type SignalingMessage = z.infer<typeof SignalingMessageSchema>;

export function parseSignalingMessage(input: unknown): SignalingMessage {
  return SignalingMessageSchema.parse(input);
}

export function parseClientSignalingMessage(input: unknown): ClientSignalingMessage {
  return ClientSignalingMessageSchema.parse(input);
}

export function parseServerSignalingMessage(input: unknown): ServerSignalingMessage {
  return ServerSignalingMessageSchema.parse(input);
}
