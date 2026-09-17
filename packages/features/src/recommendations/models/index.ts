// Recommendations models barrel export
export {
  // Type labels and values
  recommendationTypeLabels,
  recommendationTypeValues,
  recommendationPriorityLabels,
  recommendationPriorityValues,
  cplRatingLabels,
  cplRatingValues,
  // Constants
  PRIORITY_ORDER,
  CPL_THRESHOLDS,
  LEARNING_PHASE_THRESHOLD,
  BURNOUT_THRESHOLDS,
} from './recommendation.types.js';

export type {
  RecommendationType,
  RecommendationPriority,
  CplRating,
  DailyInsight,
  AdAnalysis,
  Recommendation,
  RecommendationsResult,
} from './recommendation.types.js';
