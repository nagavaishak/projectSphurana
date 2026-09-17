import { z } from 'zod';

export const listTrainingVideosSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  category: z
    .enum([
      'getting-started',
      'dashboard-guide',
      'video-creation',
      'lead-management',
      'sequences',
      'best-practices',
      'advanced',
    ])
    .optional(),
});

export type ListTrainingVideosInput = z.infer<typeof listTrainingVideosSchema>;
