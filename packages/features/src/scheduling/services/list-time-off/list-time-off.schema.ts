import { z } from 'zod';

export const listTimeOffBaseSchema = z.object({
  organizationId: z.string().min(1),
  from: z.coerce.date(),
  to: z.coerce.date(),
  practitionerId: z.string().min(1).optional(),
  /**
   * Branch filter, from the validated `X-Location-Id` header. As with blocked
   * time, `location_id` is permanently nullable and NULL = every branch.
   */
  locationId: z.string().min(1).optional(),
});

export const listTimeOffSchema = listTimeOffBaseSchema.refine(
  (d) => d.to >= d.from,
  { message: 'to must be on or after from', path: ['to'] }
);

export type ListTimeOffInput = z.infer<typeof listTimeOffSchema>;
