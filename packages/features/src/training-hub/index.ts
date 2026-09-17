// Training Hub feature barrel export

// Services
export {
  // list-training-videos
  listTrainingVideos,
  listTrainingVideosSchema,
  type ListTrainingVideosInput,
  type ListTrainingVideosResult,
  // get-training-video
  getTrainingVideo,
  getTrainingVideoSchema,
  type GetTrainingVideoInput,
  type GetTrainingVideoResult,
  // get-user-progress
  getUserProgress,
  getUserProgressSchema,
  type GetUserProgressInput,
  type GetUserProgressResult,
  // update-video-progress
  updateVideoProgress,
  updateVideoProgressSchema,
  type UpdateVideoProgressInput,
  type UpdateVideoProgressResult,
  // mark-video-completed
  markVideoCompleted,
  markVideoCompletedSchema,
  type MarkVideoCompletedInput,
  type MarkVideoCompletedResult,
} from './services/index.js';

// Models
export {
  type TrainingVideo,
  type UserVideoProgress,
  type TrainingCategory,
  type TrainingVideoWithProgress,
  type TrainingVideosByCategory,
  type UserProgressSummary,
  CATEGORY_LABELS,
  TrainingHubErrorCodes,
  type TrainingHubErrorCode,
} from './models/index.js';
