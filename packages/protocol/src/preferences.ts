import { z } from "zod";

export const AudioProcessingPreferencesSchema = z.object({
  autoGainControl: z.boolean().optional().default(true),
  echoCancellation: z.boolean().optional().default(true),
  noiseSuppression: z.boolean().optional().default(true),
});
export type AudioProcessingPreferences = z.infer<typeof AudioProcessingPreferencesSchema>;

export const VoxSettingsSchema = z.object({
  holdTimeMs: z.number().min(200).max(2000).optional().default(500),
  thresholdDb: z.number().min(-60).max(-10).optional().default(-40),
});
export type VoxSettings = z.infer<typeof VoxSettingsSchema>;

export const SidetoneSettingsSchema = z.object({
  enabled: z.boolean().optional().default(false),
  level: z.number().min(0).max(30).optional().default(15),
});
export type SidetoneSettings = z.infer<typeof SidetoneSettingsSchema>;

/**
 * Server-persisted user preferences.
 * All fields are optional so clients only store what they use.
 * The server treats this as an opaque JSON blob keyed by user ID.
 */
export const UserPreferencesSchema = z.object({
  activeGroupId: z.string().optional(),
  audioProcessing: AudioProcessingPreferencesSchema.optional(),
  channelPans: z.record(z.string(), z.number().min(-1).max(1)).optional(),
  channelVolumes: z.record(z.string(), z.number().min(0).max(100)).optional(),
  latchModeChannelIds: z.array(z.string()).optional(),
  masterVolume: z.number().min(0).max(100).optional(),
  preferredListenChannelIds: z.array(z.string()).optional(),
  sidetone: SidetoneSettingsSchema.optional(),
  talkMode: z.enum(["momentary", "latched"]).optional(),
  voxModeChannelIds: z.array(z.string()).optional(),
  voxSettings: VoxSettingsSchema.optional(),
});
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

export const SavePreferencesRequestSchema = UserPreferencesSchema;
export type SavePreferencesRequest = z.infer<typeof SavePreferencesRequestSchema>;

export const PreferencesResponseSchema = z.object({
  preferences: UserPreferencesSchema,
});
export type PreferencesResponse = z.infer<typeof PreferencesResponseSchema>;
