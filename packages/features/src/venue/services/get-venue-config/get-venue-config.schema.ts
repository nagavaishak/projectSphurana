import { z } from 'zod';

export const getVenueConfigSchema = z.object({
  organizationSlug: z.string().min(1, 'Organization slug is required'),
  // Optional per-branch slug. When omitted, the org's PRIMARY location is used
  // (a single-location org never needs a location slug).
  locationSlug: z.string().min(1).optional(),
});

export type GetVenueConfigInput = z.infer<typeof getVenueConfigSchema>;
