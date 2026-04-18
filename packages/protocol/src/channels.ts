import { z } from "zod";

import { ChannelInfoSchema, ChannelTypeSchema } from "./models.js";

const channelMutationBaseSchema = z.object({
  name: z.string().trim().min(1),
  color: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/),
  isGlobal: z.boolean().optional().default(false),
  channelType: ChannelTypeSchema.optional().default("intercom"),
  sourceUserId: z.string().min(1).optional(),
});

export const CreateChannelRequestSchema = channelMutationBaseSchema;
export type CreateChannelRequest = z.infer<typeof CreateChannelRequestSchema>;

export const UpdateChannelRequestSchema = channelMutationBaseSchema;
export type UpdateChannelRequest = z.infer<typeof UpdateChannelRequestSchema>;

export const ChannelsListResponseSchema = z.array(ChannelInfoSchema);
export type ChannelsListResponse = z.infer<typeof ChannelsListResponseSchema>;

export const ChannelMutationResponseSchema = ChannelInfoSchema;
export type ChannelMutationResponse = z.infer<typeof ChannelMutationResponseSchema>;
