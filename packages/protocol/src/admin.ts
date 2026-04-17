import { z } from "zod";

import { ChannelInfoSchema } from "./models.js";
import { GroupInfoSchema } from "./groups.js";
import { ManagedUserSchema } from "./users.js";

export const ConnectionQualityGradeSchema = z.enum([
  "excellent",
  "good",
  "fair",
  "poor",
]);
export type ConnectionQualityGrade = z.infer<typeof ConnectionQualityGradeSchema>;

export const ConnectionQualitySchema = z.object({
  grade: ConnectionQualityGradeSchema,
  roundTripTimeMs: z.number().nonnegative(),
  packetLossPercent: z.number().min(0).max(100),
  jitterMs: z.number().nonnegative(),
});
export type ConnectionQuality = z.infer<typeof ConnectionQualitySchema>;

export const PreflightStatusSchema = z.enum(["not_run", "passed", "failed"]);
export type PreflightStatus = z.infer<typeof PreflightStatusSchema>;

export const AdminDashboardUserSchema = ManagedUserSchema.extend({
  activeTalkChannelIds: z.array(z.string().min(1)),
  talking: z.boolean(),
  connectionQuality: ConnectionQualitySchema.optional(),
  preflightStatus: PreflightStatusSchema.optional(),
  directCallPeer: z.string().min(1).optional(),
});
export type AdminDashboardUser = z.infer<typeof AdminDashboardUserSchema>;

export const AdminDashboardSnapshotSchema = z.object({
  allPageActive: z.object({
    userId: z.string(),
    username: z.string(),
  }).optional(),
  channels: z.array(ChannelInfoSchema),
  groups: z.array(GroupInfoSchema).optional().default([]),
  users: z.array(AdminDashboardUserSchema),
});
export type AdminDashboardSnapshot = z.infer<typeof AdminDashboardSnapshotSchema>;
