import { user, video, withOrgScope } from '@borradh-workspace/database';
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
import { type GetVideoInput, getVideoSchema } from './get-video.schema.js';

/**
 * Internal implementation of get video
 */
const getVideoImpl = async (
  db: DbConnection,
  input: GetVideoInput
): Promise<Result<typeof result | null>> => {
  // Validate input
  const parsed = getVideoSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const [result] = await db
    .select({
      id: video.id,
      title: video.title,
      status: video.status,
      progress: video.progress,
      errorMessage: video.errorMessage,
      draftConfig: video.draftConfig,
      blobUrl: video.blobUrl,
      thumbnailUrl: video.thumbnailUrl,
      durationMs: video.durationMs,
      templateId: video.templateId,
      serviceId: video.serviceId,
      organizationId: video.organizationId,
      createdById: video.createdById,
      createdAt: video.createdAt,
      updatedAt: video.updatedAt,
      exportedAt: video.exportedAt,
      creator: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
    })
    .from(video)
    .leftJoin(user, eq(video.createdById, user.id))
    .where(and(eq(video.id, parsed.data.id), notDeleted(video)))
    .limit(1);

  return ok(result || null);
};

/**
 * Get a video by ID
 * Returns full video details including status for polling
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Get video input with video ID
 * @returns Result with video or null if not found
 */
export const getVideo = (db: DbConnection, input: GetVideoInput) =>
  trackedResult(
    'videos.getVideo',
    () => withOrgScope((tx) => getVideoImpl(tx, input), { db }),
    { properties: { videoId: input.id }, internalErrorsOnly: true }
  );

/**
 * Result type for getVideo
 */
export type GetVideoResult = Awaited<ReturnType<typeof getVideo>>;
