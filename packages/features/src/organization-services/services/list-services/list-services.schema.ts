import { serviceCategoryValues } from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * Schema for listing organization services
 */
export const listServicesSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  /**
   * Branch filter, from the validated `X-Location-Id` header.
   *
   * Two things happen when it is set, and the SECOND one is the one that
   * matters: the list is restricted to services offered at that branch, AND
   * `priceCents` / `appointmentDuration` are replaced by the branch's
   * overrides where `organization_service_location` carries them. Skipping the
   * override would leave Claire quoting the Dublin price to a Cork customer.
   */
  locationId: z.string().min(1).optional(),
  category: z.enum(serviceCategoryValues).optional(),
  isActive: z
    .preprocess(
      (v) => (v === 'true' ? true : v === 'false' ? false : v),
      z.boolean()
    )
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

/**
 * Input type inferred from schema
 */
export type ListServicesInput = z.infer<typeof listServicesSchema>;
