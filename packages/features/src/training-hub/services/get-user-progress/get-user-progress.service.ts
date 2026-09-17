import { trainingVideo, userVideoProgress } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { count, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { UserProgressSummary } from '../../models/index.js';
import {
  type GetUserProgressInput,
  getUserProgressSchema,
} from './get-user-progress.schema.js';

/**
 * Internal implementation of get user progress
 */
const getUserProgressImpl = async (
  db: DbConnection,
  input: GetUserProgressInput
): Promise<Result<UserProgressSummary>> => {
  // Validate input
  const parsed = getUserProgressSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Count total published videos
  const totalResult = await db
    .select({ count: count() })
    .from(trainingVideo)
    .where(eq(trainingVideo.isPublished, true));

  const totalVideos = totalResult[0]?.count ?? 0;

  // Count completed videos for user
  const completedQuery = await db.query.userVideoProgress.findMany({
    where: eq(userVideoProgress.userId, parsed.data.userId),
  });

  const completedVideos = completedQuery.filter((p) => p.isCompleted).length;

  // Calculate percentage
  const progressPercentage =
    totalVideos > 0 ? Math.round((completedVideos / totalVideos) * 100) : 0;

  return ok({
    totalVideos,
    completedVideos,
    progressPercentage,
  });
};

/**
 * Get user's overall progress summary across all training videos
 *
 * @param db - Database connection
 * @param input - Input with userId
 * @returns Result with progress summary
 */
export const getUserProgress = (
  db: DbConnection,
  input: GetUserProgressInput
) =>
  trackedResult(
    'training-hub.getUserProgress',
    () => getUserProgressImpl(db, input),
    {
      properties: { userId: input.userId },
      internalErrorsOnly: true,
    }
  );

export type GetUserProgressResult = Awaited<ReturnType<typeof getUserProgress>>;
