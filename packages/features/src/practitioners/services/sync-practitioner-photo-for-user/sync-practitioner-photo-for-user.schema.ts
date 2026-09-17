import { z } from 'zod';

export const syncPractitionerPhotoForUserSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  /** New avatar URL, or null to clear the practitioner photo. */
  photo: z.string().url('Invalid image URL').nullable(),
});

export type SyncPractitionerPhotoForUserInput = z.infer<
  typeof syncPractitionerPhotoForUserSchema
>;
