import { z } from 'zod';

export const listOrganizationPhotosSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  // The dashboard edits one location's gallery at a time.
  locationId: z.string().min(1, 'Location ID is required'),
});

export type ListOrganizationPhotosInput = z.infer<
  typeof listOrganizationPhotosSchema
>;
