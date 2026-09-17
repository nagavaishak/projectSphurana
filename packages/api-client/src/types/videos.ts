/**
 * @borradh-workspace/api-client - Videos API Types
 *
 * Types for the videos API endpoints.
 * Types are derived from backend packages - database types and features schemas.
 */

// Import types from features/shared (isolatedModules compliant - separate imports)
import type {
  Video as BackendVideo,
  VideoDraftConfig,
  VideoProcessingStage,
  VideoStatus,
} from '@borradh-workspace/features/shared';

// Import labels and values from features/shared (runtime values)
import {
  aiVoiceIdLabels,
  aiVoiceIdValues,
  videoProcessingStageLabels,
  videoProcessingStageValues,
  videoStatusLabels,
  videoStatusValues,
} from '@borradh-workspace/features/shared';

// Import backend input types from features
import type {
  CreateVideoInput as BackendCreateVideoInput,
  UpdateVideoInput as BackendUpdateVideoInput,
} from '@borradh-workspace/features/videos';

import type { Serialize } from './serialization.js';

// ============================================================================
// ENUM TYPES - Re-exported from database (Labels pattern)
// ============================================================================

/**
 * Video status type - re-exported from database
 */
export type { VideoStatus };

/**
 * Video processing stage type - re-exported from database
 */
export type { VideoProcessingStage };

/**
 * Labels and values for UI usage (dropdowns, badges, etc.)
 */
export { videoStatusLabels, videoStatusValues };
export { videoProcessingStageLabels, videoProcessingStageValues };
export { aiVoiceIdLabels, aiVoiceIdValues };

/**
 * AI voice ID type - derived from labels
 */
export type AiVoiceId = keyof typeof aiVoiceIdLabels;

/**
 * Narration type - recorded (talking head) or AI voiceover (TTS)
 */
export type NarrationType = 'recorded' | 'ai_voiceover';

// ============================================================================
// SHARED TYPES - Re-exported from database
// ============================================================================

/**
 * Draft config type - video creation settings
 */
export type { VideoDraftConfig };

// ============================================================================
// ENTITY TYPES - Serialized for API responses (Date → string)
// ============================================================================

/**
 * Video creator info
 */
export interface VideoCreator {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

/**
 * Video response type (API response - dates serialized to ISO strings)
 *
 * `creator` is a joined team-member snapshot present only on the read
 * projections (`GET /videos`, `GET /videos/:id`). The write endpoints
 * (create/update/export) return the bare row with no join, so the key is
 * optional here — mirroring the contracts split (`videoSchema` vs
 * `videoWithCreatorSchema`).
 */
export type Video = Serialize<BackendVideo> & {
  creator?: VideoCreator | null;
};

// ============================================================================
// RESPONSE TYPES - API-specific shapes
// ============================================================================

/**
 * List videos response
 */
export interface ListVideosResponse {
  items: Video[];
  total: number;
  limit: number;
  offset: number;
}

// ============================================================================
// INPUT TYPES - Derived from backend, omitting server-side fields
// ============================================================================

/**
 * Create video input
 * Omits organizationId, createdById (added by controller from session)
 */
export type CreateVideoInput = Omit<
  BackendCreateVideoInput,
  'organizationId' | 'createdById'
>;

/**
 * Update video input
 * Omits id, organizationId (id from route param, organizationId from session)
 */
export type UpdateVideoInput = Omit<
  BackendUpdateVideoInput,
  'id' | 'organizationId'
>;

// ============================================================================
// JOB & QUEUE TYPES - For video processing monitoring
// ============================================================================

/**
 * BullMQ job state
 */
export type JobState =
  | 'waiting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'delayed'
  | 'unknown';

/**
 * Video job status - detailed information about a video processing job
 */
export interface VideoJobStatus {
  jobId: string;
  state: JobState;
  progress: number;
  processingStage: VideoProcessingStage | null;
  stageStartedAt: string | null;
  failedReason: string | null;
  queuePosition: number | null;
  processedOn: number | null;
  finishedOn: number | null;
}

/**
 * Queue statistics - overall queue health and metrics
 */
export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
  avgProcessingTimeMs: number | null;
}
