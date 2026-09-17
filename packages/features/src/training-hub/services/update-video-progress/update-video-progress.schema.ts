import { z } from 'zod';

export const updateVideoProgressSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  trainingVideoId: z.string().min(1, 'Training video ID is required'),
  watchedSeconds: z.number().min(0, 'Watched seconds must be non-negative'),
});

export type UpdateVideoProgressInput = z.infer<
  typeof updateVideoProgressSchema
>;
