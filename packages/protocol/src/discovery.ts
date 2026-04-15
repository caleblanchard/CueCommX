import { z } from "zod";

export const DiscoveryTargetKindSchema = z.enum([
  "announced",
  "browser",
  "lan",
  "loopback",
]);
export type DiscoveryTargetKind = z.infer<typeof DiscoveryTargetKindSchema>;

export const DiscoveryTargetSchema = z.object({
  id: z.string().min(1),
  kind: DiscoveryTargetKindSchema,
  label: z.string().trim().min(1),
  url: z.string().url(),
});
export type DiscoveryTarget = z.infer<typeof DiscoveryTargetSchema>;

export const DiscoveryInterfaceSchema = z.object({
  address: z.string().min(1),
  name: z.string().trim().min(1),
  url: z.string().url(),
});
export type DiscoveryInterface = z.infer<typeof DiscoveryInterfaceSchema>;

export const DiscoveryMdnsSchema = z.object({
  enabled: z.boolean(),
  error: z.string().min(1).optional(),
  name: z.string().trim().min(1),
  port: z.number().int().positive(),
  protocol: z.literal("tcp"),
  serviceType: z.literal("_cuecommx._tcp"),
});
export type DiscoveryMdns = z.infer<typeof DiscoveryMdnsSchema>;

export const DiscoveryResponseSchema = z.object({
  announcedHost: z.string().min(1).optional(),
  detectedInterfaces: z.array(DiscoveryInterfaceSchema).default([]),
  mdns: DiscoveryMdnsSchema.optional(),
  primaryUrl: z.string().url(),
  primaryTargetId: z.string().min(1).optional(),
  connectTargets: z.array(DiscoveryTargetSchema).min(1),
});
export type DiscoveryResponse = z.infer<typeof DiscoveryResponseSchema>;
