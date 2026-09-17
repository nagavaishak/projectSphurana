import {
  type TrainingCategory,
  trainingVideo,
  userVideoProgress,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, asc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  CATEGORY_LABELS,
  type TrainingVideoWithProgress,
  type TrainingVideosByCategory,
} from '../../models/index.js';
import {
  type ListTrainingVideosInput,
  listTrainingVideosSchema,
} from './list-training-videos.schema.js';

/**
 * Internal implementation of list training videos
 */
const listTrainingVideosImpl = async (
  db: DbConnection,
  input: ListTrainingVideosInput
): Promise<Result<TrainingVideosByCategory[]>> => {
  // Validate input
  const parsed = listTrainingVideosSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Build where condition for published videos
  const conditions = [eq(trainingVideo.isPublished, true)];

  if (parsed.data.category) {
    conditions.push(eq(trainingVideo.category, parsed.data.category));
  }

  // Fetch all published training videos with user progress
  const videos = await db.query.trainingVideo.findMany({
    where: and(...conditions),
    orderBy: [asc(trainingVideo.category), asc(trainingVideo.sortOrder)],
  });

  // Fetch user's progress for all videos
  const progressRecords = await db.query.userVideoProgress.findMany({
    where: eq(userVideoProgress.userId, parsed.data.userId),
  });

  // Create a map of video progress by video ID
  const progressMap = new Map(
    progressRecords.map((p) => [p.trainingVideoId, p])
  );

  // Combine videos with progress
  const videosWithProgress: TrainingVideoWithProgress[] = videos.map(
    (video) => ({
      ...video,
      progress: progressMap.get(video.id) ?? null,
    })
  );

  // Group videos by category
  const categoryGroups = new Map<
    TrainingCategory,
    TrainingVideoWithProgress[]
  >();

  for (const video of videosWithProgress) {
    const existing = categoryGroups.get(video.category) ?? [];
    existing.push(video);
    categoryGroups.set(video.category, existing);
  }

  // Convert to array format with labels
  const result: TrainingVideosByCategory[] = Array.from(
    categoryGroups.entries()
  ).map(([category, categoryVideos]) => ({
    category,
    categoryLabel: CATEGORY_LABELS[category],
    videos: categoryVideos,
  }));

  return ok(result);
};

/**
 * List training videos grouped by category with user progress
 *
 * @param db - Database connection
 * @param input - Input with userId and optional category filter
 * @returns Result with videos grouped by category
 */
export const listTrainingVideos = (
  db: DbConnection,
  input: ListTrainingVideosInput
) =>
  trackedResult(
    'training-hub.listTrainingVideos',
    () => listTrainingVideosImpl(db, input),
    {
      properties: { userId: input.userId, category: input.category },
    }
  );

export type ListTrainingVideosResult = Awaited<
  ReturnType<typeof listTrainingVideos>
>;
