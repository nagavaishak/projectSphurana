import { z } from 'zod';

export const recordTrackingConsentSchema = z.object({
  organizationId: z.string().min(1),
  leadId: z.string().min(1),
  /** Marketing/ads measurement — the flag the pixel and CAPI are gated on. */
  ads: z.boolean(),
  analytics: z.boolean().optional(),
  source: z
    .enum(['banner', 'booking_form', 'imported', 'unknown'])
    .default('banner'),
  at: z.string().default(() => new Date().toISOString()),
  /** ISO-3166-1 alpha-2 of the visitor. Drives the US/CCPA LDU decision. */
  region: z.string().length(2).optional(),
  limitedDataUse: z.boolean().optional(),
});

export type RecordTrackingConsentInput = z.infer<
  typeof recordTrackingConsentSchema
>;
