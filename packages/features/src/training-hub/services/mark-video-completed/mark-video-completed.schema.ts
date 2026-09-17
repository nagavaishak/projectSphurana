import { z } from 'zod';

export const markVideoCompletedSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  trainingVideoId: z.string().min(1, 'Training video ID is required'),
});

export type MarkVideoCompletedInput = z.infer<typeof markVideoCompletedSchema>;
