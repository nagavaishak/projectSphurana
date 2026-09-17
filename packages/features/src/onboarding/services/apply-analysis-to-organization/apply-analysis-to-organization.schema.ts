import { z } from 'zod';
import { websiteAnalysisSnapshotSchema } from '../../../website-analysis/index.js';

export const applyAnalysisToOrganizationSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
});

export type ApplyAnalysisToOrganizationInput = z.infer<
  typeof applyAnalysisToOrganizationSchema
>;

/**
 * Lenient view of the `analysisResult` jsonb snapshot stored on the onboarding
 * session (shape produced by `analyzeWebsiteResponseSchema`, possibly enriched
 * with a business name / site title by the analysis pipeline).
 *
 * ALIAS of the shared `websiteAnalysisSnapshotSchema` — onboarding and the
 * Settings rescan read the same snapshot through the same engine, so they must
 * read it through the same schema or a field added for one silently goes
 * missing in the other. Every field degrades independently via `.catch()`, so a
 * thin or missing analysis still bootstraps an organization from the website
 * domain.
 */
export const analysisSnapshotSchema = websiteAnalysisSnapshotSchema;

export type AnalysisSnapshot = z.infer<typeof analysisSnapshotSchema>;

/**
 * Result of applying the website-analysis snapshot to a freshly created
 * organization. On the idempotent path (session already linked to an org)
 * `createdServiceIds` is empty.
 */
export interface ApplyAnalysisToOrganizationOutput {
  organizationId: string;
  createdServiceIds: string[];
}
