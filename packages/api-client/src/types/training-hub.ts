/**
 * @borradh-workspace/api-client - Training Hub API Types
 *
 * Types for the training hub API endpoints.
 * Types are derived from backend packages - database enums and types.
 */

// Import types from features/shared (isolatedModules compliant - separate imports)
import type {
  TrainingVideo as BackendTrainingVideo,
  UserVideoProgress as BackendUserVideoProgress,
  TrainingCategory,
} from '@borradh-workspace/features/shared';

// Import labels and values from features/shared (runtime values)
import {
  trainingCategoryLabels,
  trainingCategoryValues,
} from '@borradh-workspace/features/shared';

import type { Serialize } from './serialization.js';

// ============================================================================
// ENUM TYPES - Re-exported from database (Labels pattern)
// ============================================================================

/**
 * Training video category type - re-exported from database
 */
export type { TrainingCategory };

/**
 * Labels and values for UI usage (dropdowns, badges, etc.)
 */
export { trainingCategoryLabels, trainingCategoryValues };

// ============================================================================
// ENTITY TYPES - Serialized for API responses (Date → string)
// ============================================================================

/**
 * Training video entity (API response - dates serialized to ISO strings)
 */
export type TrainingVideo = Serialize<BackendTrainingVideo>;

/**
 * User video progress (API response - dates serialized to ISO strings)
 */
export type UserVideoProgress = Serialize<BackendUserVideoProgress>;

// ============================================================================
// RESPONSE TYPES - API-specific shapes
// ============================================================================

/**
 * Training video with user progress
 */
export interface TrainingVideoWithProgress extends TrainingVideo {
  progress: UserVideoProgress | null;
}

/**
 * Training videos grouped by category
 */
export interface TrainingVideosByCategory {
  category: TrainingCategory;
  categoryLabel: string;
  videos: TrainingVideoWithProgress[];
}

/**
 * User progress summary
 */
export interface UserProgressSummary {
  totalVideos: number;
  completedVideos: number;
  progressPercentage: number;
}

// ============================================================================
// INPUT TYPES - Frontend input shapes (no backend schema)
// ============================================================================

/**
 * Update video progress input
 */
export interface UpdateVideoProgressInput {
  watchedSeconds: number;
}
