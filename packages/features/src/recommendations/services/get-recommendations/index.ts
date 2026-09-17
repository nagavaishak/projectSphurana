// get-recommendations barrel export
export {
  getRecommendations,
  type GetRecommendationsResult,
} from './get-recommendations.service.js';
export {
  getRecommendationsSchema,
  type GetRecommendationsInput,
} from './get-recommendations.schema.js';

// Re-export analyzers for testing
export {
  analyzeCpl,
  getCplRating,
  analyzeLearningPhase,
  isInLearningPhase,
  detectBurnout,
  hasRisingCpl,
  getCtrDecline,
} from './analyzers/index.js';
