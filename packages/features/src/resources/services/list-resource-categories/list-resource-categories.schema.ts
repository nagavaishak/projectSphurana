import { z } from 'zod';

export const listResourceCategoriesSchema = z.object({
  /**
   * The branch the caller is looking at, from the validated `X-Location-Id`
   * header. Scopes `resourceCount` — see the service.
   */
  locationId: z.string().min(1).optional(),
  organizationId: z.string().min(1),
  /** Deactivated categories stay hidden unless the settings screen asks. */
  includeInactive: z.boolean().optional().default(false),
});

export type ListResourceCategoriesInput = z.input<
  typeof listResourceCategoriesSchema
>;
