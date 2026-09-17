import { z } from 'zod';

/**
 * Generate the ad-picker slide's candidate grid: `count` offer-ad graphics
 * (placeholder rows + `graphic-generate` jobs), each with a DIFFERENT angle
 * so the grid isn't four near-identical images.
 */
export const generateAdCandidatesSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  /** How many candidates to render. The slide shows a 2×2 grid → default 4. */
  count: z.number().int().min(1).max(8).default(4),
});

export type GenerateAdCandidatesInput = z.input<
  typeof generateAdCandidatesSchema
>;

export interface GenerateAdCandidatesOutput {
  graphicIds: string[];
}
