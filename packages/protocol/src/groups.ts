import { z } from "zod";

export const GroupInfoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  channelIds: z.array(z.string().min(1)),
});
export type GroupInfo = z.infer<typeof GroupInfoSchema>;

export const CreateGroupRequestSchema = z.object({
  name: z.string().trim().min(1),
  channelIds: z.array(z.string().min(1)),
});
export type CreateGroupRequest = z.infer<typeof CreateGroupRequestSchema>;

export const UpdateGroupRequestSchema = z.object({
  name: z.string().trim().min(1),
  channelIds: z.array(z.string().min(1)),
});
export type UpdateGroupRequest = z.infer<typeof UpdateGroupRequestSchema>;

export const GroupsListResponseSchema = z.array(GroupInfoSchema);
export type GroupsListResponse = z.infer<typeof GroupsListResponseSchema>;

export const GroupMutationResponseSchema = GroupInfoSchema;
export type GroupMutationResponse = z.infer<typeof GroupMutationResponseSchema>;
