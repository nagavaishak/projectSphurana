import { z } from 'zod';

export const backfillAssetAnalysisSchema = z.object({
  organizationId: z.string().optional(),
  /**
   * Also re-enqueue assets whose existing analysis failed or has been stuck in
   * `processing` past `staleProcessingMinutes` (ENG-216 / ENG-386 recovery).
   * Default false keeps the original "only assets with no analysis" behaviour.
   */
  requeueFailed: z.boolean().optional(),
  /** A `processing` analysis older than this is treated as stuck. Default 30. */
  staleProcessingMinutes: z.number().int().positive().optional(),
});

export type BackfillAssetAnalysisInput = z.input<
  typeof backfillAssetAnalysisSchema
>;
