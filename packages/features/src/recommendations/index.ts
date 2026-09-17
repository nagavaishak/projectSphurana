// Recommendations feature barrel export

// Models
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
} from './models/index.js';

export type {
  RecommendationType,
  RecommendationPriority,
  CplRating,
  DailyInsight,
  AdAnalysis,
  Recommendation,
  RecommendationsResult,
} from './models/index.js';

// Services
export {
  getRecommendations,
  getRecommendationsSchema,
  // Analyzers
  analyzeCpl,
  getCplRating,
  analyzeLearningPhase,
  isInLearningPhase,
  detectBurnout,
  hasRisingCpl,
  getCtrDecline,
} from './services/index.js';

export type {
  GetRecommendationsInput,
  GetRecommendationsResult,
} from './services/index.js';
