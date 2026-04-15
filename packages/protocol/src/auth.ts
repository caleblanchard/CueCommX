import { z } from "zod";

import { ChannelInfoSchema, PROTOCOL_VERSION, UserInfoSchema } from "./models.js";

export const AuthCredentialsSchema = z.object({
  username: z.string().trim().min(1),
  pin: z.string().trim().min(1).optional(),
});
export type AuthCredentials = z.infer<typeof AuthCredentialsSchema>;

export const LoginRequestSchema = AuthCredentialsSchema;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const SetupAdminRequestSchema = AuthCredentialsSchema;
export type SetupAdminRequest = z.infer<typeof SetupAdminRequestSchema>;

export const AuthSuccessResponseSchema = z.object({
  success: z.literal(true),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  sessionToken: z.string().min(1),
  user: UserInfoSchema,
  channels: z.array(ChannelInfoSchema),
});
export type AuthSuccessResponse = z.infer<typeof AuthSuccessResponseSchema>;

export const AuthFailureResponseSchema = z.object({
  success: z.literal(false),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  error: z.string().trim().min(1),
});
export type AuthFailureResponse = z.infer<typeof AuthFailureResponseSchema>;

export const LoginResponseSchema = z.discriminatedUnion("success", [
  AuthSuccessResponseSchema,
  AuthFailureResponseSchema,
]);
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const SetupAdminResponseSchema = LoginResponseSchema;
export type SetupAdminResponse = z.infer<typeof SetupAdminResponseSchema>;
