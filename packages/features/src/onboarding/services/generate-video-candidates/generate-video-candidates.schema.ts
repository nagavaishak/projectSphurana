import { z } from 'zod';

/**
 * Kick off the video-picker slide's candidates: `count` offer-format video
 * renders (minutes-scale — this service only QUEUES, never waits).
 */
export const generateVideoCandidatesSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  /** How many candidates to render. The slide shows a 2×2 grid → default 4. */
  count: z.number().int().min(1).max(8).default(4),
});

export type GenerateVideoCandidatesInput = z.input<
  typeof generateVideoCandidatesSchema
>;

export interface GenerateVideoCandidatesOutput {
  videoIds: string[];
}
