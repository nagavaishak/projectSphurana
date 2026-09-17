import { z } from 'zod';

/**
 * Schema for getting a single organization service
 */
export const getServiceSchema = z.object({
  id: z.string().min(1, 'Service ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  /**
   * Branch, from the validated `X-Location-Id` header. Does NOT gate access —
   * a service is still readable by id from any branch — but when set,
   * `priceCents` / `appointmentDuration` come back as the branch's overrides.
   * `listServices` does the same; the two must agree or the detail page would
   * contradict the list it was opened from.
   */
  locationId: z.string().min(1).optional(),
});

/**
 * Input type inferred from schema
 */
export type GetServiceInput = z.infer<typeof getServiceSchema>;
