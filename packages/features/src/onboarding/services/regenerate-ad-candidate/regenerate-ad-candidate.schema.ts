import { z } from 'zod';

/**
 * Re-roll ONE ad-picker candidate with the owner's change request
 * (per-card "Regenerate" dialog on the ad-picker slide).
 */
export const regenerateAdCandidateSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  /** The candidate to re-roll — must be in `session.adCandidateGraphicIds`. */
  graphicId: z.string().min(1, 'graphicId is required'),
  /** The owner's change request ("make it brighter", "lead with the price"). */
  prompt: z.string().min(1, 'prompt is required').max(500),
});

export type RegenerateAdCandidateInput = z.infer<
  typeof regenerateAdCandidateSchema
>;

export interface RegenerateAdCandidateOutput {
  /** The REPLACEMENT graphic id (a fresh row is minted per regenerate). */
  graphicId: string;
}
