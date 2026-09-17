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
  type MarkVideoCompletedInput,
  markVideoCompletedSchema,
} from './mark-video-completed.schema.js';

/**
 * Internal implementation of mark video completed
 */
const markVideoCompletedImpl = async (
  db: DbConnection,
  input: MarkVideoCompletedInput
): Promise<Result<UserVideoProgress>> => {
  // Validate input
  const parsed = markVideoCompletedSchema.safeParse(input);
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

  const now = new Date();

  if (existingProgress) {
    // Update existing progress to completed
    const [updated] = await db
      .update(userVideoProgress)
      .set({
        isCompleted: true,
        completedAt: existingProgress.completedAt ?? now,
        watchedSeconds:
          video.durationSeconds ?? existingProgress.watchedSeconds,
        updatedAt: now,
      })
      .where(eq(userVideoProgress.id, existingProgress.id))
      .returning();

    return ok(updated);
  }

  // Create new completed progress record
  const progressId = `uvp_${crypto.randomUUID().replace(/-/g, '')}`;

  const [created] = await db
    .insert(userVideoProgress)
    .values({
      id: progressId,
      userId: parsed.data.userId,
      trainingVideoId: parsed.data.trainingVideoId,
      watchedSeconds: video.durationSeconds ?? 0,
      isCompleted: true,
      completedAt: now,
    })
    .returning();

  return ok(created);
};

/**
 * Mark a training video as completed for a user
 *
 * @param db - Database connection
 * @param input - Input with userId and trainingVideoId
 * @returns Result with updated progress record
 */
export const markVideoCompleted = (
  db: DbConnection,
  input: MarkVideoCompletedInput
) =>
  trackedResult(
    'training-hub.markVideoCompleted',
    () => markVideoCompletedImpl(db, input),
    {
      properties: { userId: input.userId, videoId: input.trainingVideoId },
    }
  );

export type MarkVideoCompletedResult = Awaited<
  ReturnType<typeof markVideoCompleted>
>;
