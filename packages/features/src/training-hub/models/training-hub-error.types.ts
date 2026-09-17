/**
 * Training hub specific error codes
 */
export const TrainingHubErrorCodes = {
  VIDEO_NOT_FOUND: 'VIDEO_NOT_FOUND',
  PROGRESS_NOT_FOUND: 'PROGRESS_NOT_FOUND',
} as const;

export type TrainingHubErrorCode =
  (typeof TrainingHubErrorCodes)[keyof typeof TrainingHubErrorCodes];
