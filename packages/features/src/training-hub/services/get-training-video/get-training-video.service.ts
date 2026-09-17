import { trainingVideo, userVideoProgress } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  TrainingHubErrorCodes,
  type TrainingVideoWithProgress,
} from '../../models/index.js';
import {
  type GetTrainingVideoInput,
  getTrainingVideoSchema,
} from './get-training-video.schema.js';

/**
 * Internal implementation of get training video
 */
const getTrainingVideoImpl = async (
  db: DbConnection,
  input: GetTrainingVideoInput
): Promise<Result<TrainingVideoWithProgress>> => {
  // Validate input
  const parsed = getTrainingVideoSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Fetch the training video
  const video = await db.query.trainingVideo.findFirst({
    where: and(
      eq(trainingVideo.id, parsed.data.trainingVideoId),
      eq(trainingVideo.isPublished, true)
    ),
  });

  if (!video) {
    return err(
      new FeatureError(
        TrainingHubErrorCodes.VIDEO_NOT_FOUND,
        'Training video not found'
      )
    );
  }

  // Fetch user's progress for this video
  const progress = await db.query.userVideoProgress.findFirst({
    where: and(
      eq(userVideoProgress.userId, parsed.data.userId),
      eq(userVideoProgress.trainingVideoId, parsed.data.trainingVideoId)
    ),
  });

  return ok({
    ...video,
    progress: progress ?? null,
  });
};

/**
 * Get a single training video with user progress
 *
 * @param db - Database connection
 * @param input - Input with userId and trainingVideoId
 * @returns Result with video and progress
 */
export const getTrainingVideo = (
  db: DbConnection,
  input: GetTrainingVideoInput
) =>
  trackedResult(
    'training-hub.getTrainingVideo',
    () => getTrainingVideoImpl(db, input),
    {
      properties: { userId: input.userId, videoId: input.trainingVideoId },
      internalErrorsOnly: true,
    }
  );

export type GetTrainingVideoResult = Awaited<
  ReturnType<typeof getTrainingVideo>
>;
