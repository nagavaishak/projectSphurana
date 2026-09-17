import { z } from 'zod';

/**
 * Job priority levels for asset analysis
 * Lower number = higher priority
 */
export const ANALYSIS_PRIORITY = {
  HIGH: 1, // User-initiated re-analysis
  NORMAL: 5, // Standard post-upload analysis
  LOW: 10, // Batch analysis
} as const;

export type AnalysisPriority =
  (typeof ANALYSIS_PRIORITY)[keyof typeof ANALYSIS_PRIORITY];

/**
 * Queue asset analysis input schema
 */
export const queueAssetAnalysisSchema = z.object({
  assetId: z.string().min(1, 'Asset ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  /** Job priority - lower number = higher priority. Default: NORMAL (5) */
  priority: z
    .number()
    .min(1)
    .max(10)
    .optional()
    .default(ANALYSIS_PRIORITY.NORMAL),
});

/** Input type (before parsing) */
export type QueueAssetAnalysisInput = z.input<typeof queueAssetAnalysisSchema>;

/** Output type (after parsing) */
export type QueueAssetAnalysisParsed = z.infer<typeof queueAssetAnalysisSchema>;
