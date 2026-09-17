import type { DbConnection } from '../../../shared/index.js';
import {
  type FindSimilarActionIntentsResult,
  findSimilarActionIntents,
} from './find-similar-action-intents/index.js';

export {
  normalizeActionKey,
  tokenize,
  jaccardSimilarity,
} from './normalize.js';
export * from './record-action-intent/index.js';
export * from './find-similar-action-intents/index.js';

/**
 * Convenience wrapper: pre-create dedupe for Meta ad campaigns (#79 #151).
 * Thin alias over {@link findSimilarActionIntents} with the `create_campaign`
 * action fixed — this is the `find-similar-campaigns` deliverable in the plan.
 */
export const findSimilarCampaigns = (
  db: DbConnection,
  input: {
    organizationId: string;
    name?: string;
    objective?: string;
    serviceIds?: string[];
    windowDays?: number;
    minSimilarity?: number;
    limit?: number;
  }
): Promise<FindSimilarActionIntentsResult> =>
  findSimilarActionIntents(db, { ...input, action: 'create_campaign' });

/**
 * Convenience wrapper: pre-create dedupe for Meta lead forms (#79).
 */
export const findSimilarLeadForms = (
  db: DbConnection,
  input: {
    organizationId: string;
    name?: string;
    serviceIds?: string[];
    windowDays?: number;
    minSimilarity?: number;
    limit?: number;
  }
): Promise<FindSimilarActionIntentsResult> =>
  findSimilarActionIntents(db, { ...input, action: 'create_lead_form' });
