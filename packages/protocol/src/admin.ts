import { z } from "zod";

import { ChannelInfoSchema } from "./models.js";
import { ManagedUserSchema } from "./users.js";

export const AdminDashboardUserSchema = ManagedUserSchema.extend({
  activeTalkChannelIds: z.array(z.string().min(1)),
  talking: z.boolean(),
});
export type AdminDashboardUser = z.infer<typeof AdminDashboardUserSchema>;

export const AdminDashboardSnapshotSchema = z.object({
  channels: z.array(ChannelInfoSchema),
  users: z.array(AdminDashboardUserSchema),
});
export type AdminDashboardSnapshot = z.infer<typeof AdminDashboardSnapshotSchema>;
