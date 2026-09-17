import { z } from 'zod';

export const getTrainingVideoSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  trainingVideoId: z.string().min(1, 'Training video ID is required'),
});

export type GetTrainingVideoInput = z.infer<typeof getTrainingVideoSchema>;
