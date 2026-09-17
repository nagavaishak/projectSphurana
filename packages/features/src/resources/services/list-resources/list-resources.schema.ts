import { z } from 'zod';

export const listResourcesSchema = z.object({
  organizationId: z.string().min(1),
  categoryId: z.string().min(1).optional(),
  locationId: z.string().min(1).optional(),
  /** Deactivated resources stay hidden unless the settings screen asks. */
  includeInactive: z.boolean().optional().default(false),
});

export type ListResourcesInput = z.input<typeof listResourcesSchema>;
