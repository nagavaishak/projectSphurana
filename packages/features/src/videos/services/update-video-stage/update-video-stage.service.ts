import { video } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type UpdateVideoStageInput,
  updateVideoStageSchema,
} from './update-video-stage.schema.js';

/**
 * Internal implementation of update video stage
 */
const updateVideoStageImpl = async (
  db: DbConnection,
  input: UpdateVideoStageInput
): Promise<Result<typeof result>> => {
  // Validate input
  const parsed = updateVideoStageSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { videoId, stage } = parsed.data;

  // Update the processing stage and timestamp
  const [result] = await db
    .update(video)
    .set({
      processingStage: stage,
      stageStartedAt: new Date(),
    })
    .where(and(eq(video.id, videoId), notDeleted(video)))
    .returning();

  if (!result) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Video not found', { videoId })
    );
  }

  return ok(result);
};

/**
 * Update a video's processing stage
 * Used by the video worker to report detailed progress during rendering
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Video ID and new processing stage
 * @returns Result with updated video or error
 */
export const updateVideoStage = (
  db: DbConnection,
  input: UpdateVideoStageInput
) =>
  trackedResult(
    'videos.updateVideoStage',
    () => updateVideoStageImpl(db, input),
    {
      properties: { videoId: input.videoId, stage: input.stage },
    }
  );

/**
 * Result type for updateVideoStage
 */
export type UpdateVideoStageResult = Awaited<
  ReturnType<typeof updateVideoStage>
>;
