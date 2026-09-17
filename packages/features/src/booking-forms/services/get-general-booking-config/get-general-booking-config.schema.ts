import { z } from 'zod';

export const getGeneralBookingConfigSchema = z.object({
  organizationSlug: z.string().min(1, 'Organization slug is required'),
  // Optional per-branch slug. When omitted the org's DEFAULT branch is used —
  // the pre-branch behaviour, kept so a single-location org (and any caller
  // that has not been taught about branches yet) is unaffected.
  locationSlug: z.string().min(1).optional(),
});

export type GetGeneralBookingConfigInput = z.infer<
  typeof getGeneralBookingConfigSchema
>;
