import { z } from 'zod';

export const healthCheckSchema = z.object({
  organizationId: z.string().min(1),
  /** Internal page ID to check (optional — uses default page if not provided) */
  metaAdsPageId: z.string().optional(),
  /** If the ad targets Instagram, set to true to check IG linkage */
  requireInstagram: z.boolean().optional().default(false),
});

export type HealthCheckInput = z.infer<typeof healthCheckSchema>;
