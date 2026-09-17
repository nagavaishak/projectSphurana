import { z } from 'zod';

export const stageItemClipEditsSchema = z.object({
  itemId: z.string().min(1),
  organizationId: z.string().min(1),
  /**
   * The WHOLE list, in render order — not a diff.
   *
   * The clip list editor hands back what the owner is looking at, so a diff
   * would be the client re-deriving an intention the list already states. It is
   * also the only shape that can express a reorder.
   */
  assetIds: z.array(z.string().min(1)).min(1).max(20),
});

export type StageItemClipEditsInput = z.infer<typeof stageItemClipEditsSchema>;

export interface StageItemClipEditsResponse {
  /** How many clips the staged list holds. */
  clipCount: number;
  /** Always true once staged — present so the client reads one shape. */
  hasStagedEdits: boolean;
}
