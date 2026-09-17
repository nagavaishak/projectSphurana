import { z } from 'zod';

export const createOrganizationPhotoSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  // The venue (location) this photo belongs to. Validated to belong to the org.
  locationId: z.string().min(1, 'Location ID is required'),
  url: z.string().min(1, 'Photo URL is required'),
  caption: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  isCover: z.boolean().optional(),
});

export type CreateOrganizationPhotoInput = z.infer<
  typeof createOrganizationPhotoSchema
>;
