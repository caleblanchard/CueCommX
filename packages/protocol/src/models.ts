import { z } from "zod";

export const PROTOCOL_VERSION = 1;

export const UserRoleSchema = z.enum(["admin", "operator", "user"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const ChannelPermissionSchema = z.object({
  channelId: z.string().min(1),
  canTalk: z.boolean(),
  canListen: z.boolean(),
});
export type ChannelPermission = z.infer<typeof ChannelPermissionSchema>;

export const ChannelTypeSchema = z.enum(["intercom", "program"]);
export type ChannelType = z.infer<typeof ChannelTypeSchema>;

export const ChannelInfoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  isGlobal: z.boolean().optional().default(false),
  channelType: ChannelTypeSchema.optional().default("intercom"),
  sourceUserId: z.string().min(1).optional(),
});
export type ChannelInfo = z.infer<typeof ChannelInfoSchema>;

export const UserInfoSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  role: UserRoleSchema,
  channelPermissions: z.array(ChannelPermissionSchema),
});
export type UserInfo = z.infer<typeof UserInfoSchema>;

export const OperatorStateSchema = z.object({
  talkChannelIds: z.array(z.string().min(1)),
  listenChannelIds: z.array(z.string().min(1)),
  talking: z.boolean(),
});
export type OperatorState = z.infer<typeof OperatorStateSchema>;

export const StatusResponseSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  uptime: z.number().nonnegative(),
  connectedUsers: z.number().int().nonnegative(),
  maxUsers: z.number().int().positive(),
  channels: z.number().int().nonnegative(),
  needsAdminSetup: z.boolean(),
  protocolVersion: z.literal(PROTOCOL_VERSION),
});
export type StatusResponse = z.infer<typeof StatusResponseSchema>;
