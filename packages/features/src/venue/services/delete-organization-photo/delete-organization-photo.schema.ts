import { z } from 'zod';

export const deleteOrganizationPhotoSchema = z.object({
  id: z.string().min(1, 'Photo ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type DeleteOrganizationPhotoInput = z.infer<
  typeof deleteOrganizationPhotoSchema
>;
