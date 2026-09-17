import { z } from 'zod';

export const transcribeVideoSchema = z.object({
  id: z.string().min(1, 'Video ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type TranscribeVideoInput = z.infer<typeof transcribeVideoSchema>;
