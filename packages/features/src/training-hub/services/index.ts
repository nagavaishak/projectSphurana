// List training videos
export {
  listTrainingVideos,
  listTrainingVideosSchema,
  type ListTrainingVideosInput,
  type ListTrainingVideosResult,
} from './list-training-videos/index.js';

// Get training video
export {
  getTrainingVideo,
  getTrainingVideoSchema,
  type GetTrainingVideoInput,
  type GetTrainingVideoResult,
} from './get-training-video/index.js';

// Get user progress
export {
  getUserProgress,
  getUserProgressSchema,
  type GetUserProgressInput,
  type GetUserProgressResult,
} from './get-user-progress/index.js';

// Update video progress
export {
  updateVideoProgress,
  updateVideoProgressSchema,
  type UpdateVideoProgressInput,
  type UpdateVideoProgressResult,
} from './update-video-progress/index.js';

// Mark video completed
export {
  markVideoCompleted,
  markVideoCompletedSchema,
  type MarkVideoCompletedInput,
  type MarkVideoCompletedResult,
} from './mark-video-completed/index.js';
