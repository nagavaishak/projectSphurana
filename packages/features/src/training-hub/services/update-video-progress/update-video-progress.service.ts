import {
  type UserVideoProgress,
  trainingVideo,
  userVideoProgress,
} from '@borradh-workspace/database';
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
import { TrainingHubErrorCodes } from '../../models/index.js';
import {
  type UpdateVideoProgressInput,
  updateVideoProgressSchema,
} from './update-video-progress.schema.js';

/**
 * Internal implementation of update video progress
 */
const updateVideoProgressImpl = async (
  db: DbConnection,
  input: UpdateVideoProgressInput
): Promise<Result<UserVideoProgress>> => {
  // Validate input
  const parsed = updateVideoProgressSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Verify the video exists
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

  // Check if progress record exists
  const existingProgress = await db.query.userVideoProgress.findFirst({
    where: and(
      eq(userVideoProgress.userId, parsed.data.userId),
      eq(userVideoProgress.trainingVideoId, parsed.data.trainingVideoId)
    ),
  });

  if (existingProgress) {
    // Update existing progress (only if new value is greater)
    const newWatchedSeconds = Math.max(
      existingProgress.watchedSeconds,
      parsed.data.watchedSeconds
    );

    const [updated] = await db
      .update(userVideoProgress)
      .set({
        watchedSeconds: newWatchedSeconds,
        updatedAt: new Date(),
      })
      .where(eq(userVideoProgress.id, existingProgress.id))
      .returning();

    return ok(updated);
  }

  // Create new progress record
  const progressId = `uvp_${crypto.randomUUID().replace(/-/g, '')}`;

  const [created] = await db
    .insert(userVideoProgress)
    .values({
      id: progressId,
      userId: parsed.data.userId,
      trainingVideoId: parsed.data.trainingVideoId,
      watchedSeconds: parsed.data.watchedSeconds,
      isCompleted: false,
    })
    .returning();

  return ok(created);
};

/**
 * Update user's progress on a training video
 *
 * @param db - Database connection
 * @param input - Input with userId, trainingVideoId, and watchedSeconds
 * @returns Result with updated progress record
 */
export const updateVideoProgress = (
  db: DbConnection,
  input: UpdateVideoProgressInput
) =>
  trackedResult(
    'training-hub.updateVideoProgress',
    () => updateVideoProgressImpl(db, input),
    {
      properties: { userId: input.userId, videoId: input.trainingVideoId },
    }
  );

export type UpdateVideoProgressResult = Awaited<
  ReturnType<typeof updateVideoProgress>
>;
