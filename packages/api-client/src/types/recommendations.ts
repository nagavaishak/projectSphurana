/**
 * @borradh-workspace/api-client - Recommendations API Types
 *
 * Types for the AI recommendations API endpoint.
 * Types are derived from backend packages - features recommendations module.
 *
 * IMPORTANT: Import from /models subpath to avoid pulling in server-side code
 * (services use @sentry/node which doesn't work in browser bundles)
 */

// Import types from features/recommendations/models (isolatedModules compliant - separate imports)
import type {
  Recommendation as BackendRecommendation,
  RecommendationsResult as BackendRecommendationsResult,
  CplRating,
  RecommendationPriority,
  RecommendationType,
} from '@borradh-workspace/features/recommendations/models';

// Import labels and values from features/recommendations/models (runtime values - no server deps)
import {
  BURNOUT_THRESHOLDS,
  CPL_THRESHOLDS,
  LEARNING_PHASE_THRESHOLD,
  cplRatingLabels,
  cplRatingValues,
  recommendationPriorityLabels,
  recommendationPriorityValues,
  recommendationTypeLabels,
  recommendationTypeValues,
} from '@borradh-workspace/features/recommendations/models';

// ============================================================================
// ENUM TYPES - Re-exported from features
// ============================================================================

/**
 * Recommendation type - scale, turn_off, learning_phase, burnout
 */
export type { RecommendationType };

/**
 * Recommendation priority - critical, high, medium, low
 */
export type { RecommendationPriority };

/**
 * CPL rating - excellent, good, acceptable, concerning, poor
 */
export type { CplRating };

/**
 * Labels and values for UI usage (dropdowns, badges, etc.)
 */
export {
  recommendationTypeLabels,
  recommendationTypeValues,
  recommendationPriorityLabels,
  recommendationPriorityValues,
  cplRatingLabels,
  cplRatingValues,
  CPL_THRESHOLDS,
  LEARNING_PHASE_THRESHOLD,
  BURNOUT_THRESHOLDS,
};

// ============================================================================
// ENTITY TYPES - API responses
// ============================================================================

/**
 * Recommendation entity (API response)
 * Already has string dates from the backend
 */
export type Recommendation = BackendRecommendation;

/**
 * Recommendations result containing the array of recommendations
 */
export type RecommendationsResult = BackendRecommendationsResult;

// ============================================================================
// INPUT TYPES - Derived from backend, omitting server-side fields
// ============================================================================

/**
 * Get recommendations query params
 * Omits organizationId (added by controller from session)
 * days and limit are optional since they have defaults in the schema
 */
export interface GetRecommendationsParams {
  days?: number;
  limit?: number;
}
