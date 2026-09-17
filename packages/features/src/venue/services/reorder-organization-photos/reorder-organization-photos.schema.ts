import { z } from 'zod';

export const reorderOrganizationPhotosSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  // The gallery being reordered belongs to one location (venue).
  locationId: z.string().min(1, 'Location ID is required'),
  // The photo ids in the new display order. sortOrder is set to the array index.
  orderedIds: z
    .array(z.string().min(1))
    .min(1, 'At least one photo id is required'),
});

export type ReorderOrganizationPhotosInput = z.infer<
  typeof reorderOrganizationPhotosSchema
>;
