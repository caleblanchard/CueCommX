import { getReconnectDelay } from "@cuecommx/core";
import {
  ChannelInfoSchema,
  PROTOCOL_VERSION,
  StatusResponseSchema,
  type ChannelInfo,
  type StatusResponse,
} from "@cuecommx/protocol";
import { designTokens } from "@cuecommx/design-tokens";

export const previewChannels: ChannelInfo[] = ChannelInfoSchema.array().parse([
  { id: "ch-production", name: "Production", color: "#EF4444" },
  { id: "ch-audio", name: "Audio", color: "#3B82F6" },
  { id: "ch-video", name: "Video/Camera", color: "#10B981" },
  { id: "ch-lighting", name: "Lighting", color: "#F59E0B" },
  { id: "ch-stage", name: "Stage", color: "#8B5CF6" },
]);

export const previewStatus: StatusResponse = StatusResponseSchema.parse({
  name: "CueCommX Local Server",
  version: "0.1.0",
  uptime: 0,
  connectedUsers: 0,
  maxUsers: 30,
  channels: previewChannels.length,
  needsAdminSetup: false,
  protocolVersion: PROTOCOL_VERSION,
});

export interface MobileFoundationState {
  channels: ChannelInfo[];
  firstReconnectDelayMs: number;
  status: StatusResponse;
  talkTargetHeight: number;
}

export function buildMobileFoundationState(
  status: StatusResponse,
  channels: ChannelInfo[],
): MobileFoundationState {
  return {
    channels,
    firstReconnectDelayMs: getReconnectDelay(
      1,
      {
        baseDelayMs: 250,
        jitterMs: 250,
        maxDelayMs: 10_000,
      },
      () => 0,
    ),
    status,
    talkTargetHeight: designTokens.spacing.touchTarget,
  };
}
