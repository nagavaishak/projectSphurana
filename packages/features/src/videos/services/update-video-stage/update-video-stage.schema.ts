import { videoProcessingStageValues } from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * Update video processing stage input schema
 */
export const updateVideoStageSchema = z.object({
  videoId: z.string().min(1, 'Video ID is required'),
  stage: z.enum(videoProcessingStageValues),
});

export type UpdateVideoStageInput = z.infer<typeof updateVideoStageSchema>;
