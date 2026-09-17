import { z } from 'zod';

/**
 * Schema for creating a service variant — an OPTIONAL customer-chosen pricing
 * option on a service ("1 Area", "3 sessions", "60 min"). See
 * docs/plans/service-pricing-model.md.
 *
 * `organizationId` scopes the write: the parent `serviceId` must belong to the
 * active org (validated in the service). `priceCents` is nullable so a clinic
 * can add an option before pricing it; `durationMinutes` overrides the service
 * default when set.
 */
export const createServiceVariantSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  serviceId: z.string().min(1, 'Service ID is required'),
  name: z.string().min(1, 'Variant name is required').max(100),
  priceCents: z.number().int().min(0).optional().nullable(),
  durationMinutes: z.number().int().min(5).max(480).optional().nullable(),
  sortOrder: z.number().int().min(0).optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export type CreateServiceVariantInput = z.infer<
  typeof createServiceVariantSchema
>;
