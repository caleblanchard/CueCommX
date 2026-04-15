import { z } from "zod";

import { ChannelPermissionSchema, UserInfoSchema, UserRoleSchema } from "./models.js";

const userMutationBaseSchema = z.object({
  username: z.string().trim().min(1),
  role: UserRoleSchema,
  channelPermissions: z.array(ChannelPermissionSchema),
});

export const ManagedUserSchema = UserInfoSchema.extend({
  online: z.boolean(),
});
export type ManagedUser = z.infer<typeof ManagedUserSchema>;

export const CreateUserRequestSchema = userMutationBaseSchema.extend({
  pin: z.string().trim().min(1).optional(),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const UpdateUserRequestSchema = userMutationBaseSchema
  .extend({
    clearPin: z.boolean().optional(),
    pin: z.string().trim().min(1).optional(),
  })
  .refine((value) => !(value.pin && value.clearPin), {
    message: "Cannot provide both pin and clearPin.",
    path: ["clearPin"],
  });
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

export const UsersListResponseSchema = ManagedUserSchema.array();
export type UsersListResponse = z.infer<typeof UsersListResponseSchema>;

export const UserMutationResponseSchema = ManagedUserSchema;
export type UserMutationResponse = z.infer<typeof UserMutationResponseSchema>;
