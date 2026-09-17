import { z } from 'zod';

/**
 * Input for `applyBatchItemVideoEdits` — commit everything staged on this item
 * in one render.
 */
export const applyBatchItemVideoEditsSchema = z.object({
  itemId: z.string().min(1),
  organizationId: z.string().min(1),
});

export type ApplyBatchItemVideoEditsInput = z.infer<
  typeof applyBatchItemVideoEditsSchema
>;

export interface ApplyBatchItemVideoEditsResponse {
  /** True when a render was started — by an edit, or by approving as-is. */
  applied: boolean;
  /**
   * How the render was reached, so the caller can say the true thing.
   *
   * - `edits`      — staged changes were committed and re-rendered
   * - `as_is`      — nothing was edited; the auto-assembled cut was approved
   * - `no_changes` — nothing edited and a cut already exists, so nothing ran
   */
  outcome: 'edits' | 'as_is' | 'no_changes';
  /** Re-renders this item's edits have now cost, including this one. */
  renderCount: number;
  /**
   * The video now rendering — which is NOT always the one the caller was
   * looking at. An edit to a cut that already rendered forks, so this is the
   * fork's id, and a client that watched the original would sit on a finished
   * video forever while the new one rendered somewhere it could not see. That
   * is the exact bug five attempts at this feature kept reproducing; returning
   * the id is what lets the panel follow the render that was actually started.
   */
  videoId: string;
}
