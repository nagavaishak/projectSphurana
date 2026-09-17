import { z } from 'zod';

export const listBlockedTimeBaseSchema = z.object({
  organizationId: z.string().min(1),
  from: z.coerce.date(),
  to: z.coerce.date(),
  practitionerId: z.string().min(1).optional(),
  /**
   * Branch filter, from the validated `X-Location-Id` header. `location_id` is
   * PERMANENTLY nullable on this table and NULL means "applies to every
   * branch", so filtering keeps the NULL rows — see the service.
   */
  locationId: z.string().min(1).optional(),
});

export const listBlockedTimeSchema = listBlockedTimeBaseSchema.refine(
  (d) => d.to >= d.from,
  { message: 'to must be on or after from', path: ['to'] }
);

export type ListBlockedTimeInput = z.infer<typeof listBlockedTimeSchema>;
