import { z } from 'zod';

export const setCoverPhotoSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  // The cover is per-venue: at most one cover per location.
  locationId: z.string().min(1, 'Location ID is required'),
  photoId: z.string().min(1, 'Photo ID is required'),
});

export type SetCoverPhotoInput = z.infer<typeof setCoverPhotoSchema>;
