import { video, withOrgScope } from '@borradh-workspace/database';
import {
  isFeatureOn,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { deleteObject, parseS3Url } from '@borradh-workspace/storage';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  findAdsUsingCreative,
  logAuditEvent,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type DeleteVideoInput,
  deleteVideoSchema,
} from './delete-video.schema.js';

/**
 * Clean up S3 assets associated with a deleted video.
 * Fire-and-forget — failures are logged but don't break the delete operation.
 */
async function cleanupVideoS3Assets(
  deletedVideo: typeof video.$inferSelect
): Promise<void> {
  const urls: string[] = [];

  if (deletedVideo.blobUrl) urls.push(deletedVideo.blobUrl);
  if (deletedVideo.thumbnailUrl) urls.push(deletedVideo.thumbnailUrl);
  // Note: talkingHeadUrl is NOT deleted — it's user-uploaded source material that may be shared

  for (const url of urls) {
    const s3Info = parseS3Url(url);
    if (s3Info) {
      try {
        await deleteObject({ bucket: s3Info.bucket, key: s3Info.key });
      } catch (error) {
        logError('videos.deleteVideo.s3Cleanup', error, {
          feature: 'videos',
          extra: { url, videoId: deletedVideo.id },
        });
      }
    }
  }
}

/**
 * Internal implementation of delete video (runs inside withOrgScope transaction)
 */
const deleteVideoImpl = async (
  db: DbConnection,
  input: DeleteVideoInput
): Promise<Result<typeof video.$inferSelect | null>> => {
  // Validate input
  const parsed = deleteVideoSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // An ad still pointing at this video would be left with a dangling
  // reference — and on the hard-delete path the media is unrecoverable.
  const existing = await db.query.video.findFirst({
    where: eq(video.id, parsed.data.id),
    columns: { id: true, organizationId: true },
  });
  if (existing) {
    const inUse = await findAdsUsingCreative(db, {
      creativeId: existing.id,
      organizationId: existing.organizationId,
    });
    if (inUse) return err(inUse);
  }

  if (!(await isFeatureOn('killswitch-soft-deletes'))) {
    const [deleted] = await db
      .delete(video)
      .where(eq(video.id, parsed.data.id))
      .returning();
    return ok(deleted ?? null);
  }

  const [result] = await db
    .update(video)
    .set({ deletedAt: new Date() })
    .where(and(eq(video.id, parsed.data.id), notDeleted(video)))
    .returning();
  // S3 cleanup deferred to hard-purge: soft-deleted videos retain their blobUrl for recovery

  return ok(result ?? null);
};

/**
 * Delete a video
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Delete video input with video ID
 * @returns Result with deleted video or null if not found
 */
export const deleteVideo = async (
  db: DbConnection,
  input: DeleteVideoInput
) => {
  const result = await trackedResult(
    'videos.deleteVideo',
    () => withOrgScope((tx) => deleteVideoImpl(tx, input), { db }),
    { properties: { videoId: input.id } }
  );

  if (result.success && result.data) {
    const vid = result.data;
    // Audit log fires after transaction commits — safe from phantom entries on rollback
    logAuditEvent(db, {
      action: 'delete',
      entityType: 'video',
      entityId: vid.id,
      actorType: 'user',
      actorId: input.actorId ?? null,
      organizationId: vid.organizationId,
    }).catch((error) =>
      logError('videos.deleteVideo.auditLog', error, {
        feature: 'videos',
        extra: { videoId: vid.id, organizationId: vid.organizationId },
      })
    );

    // S3 cleanup only on hard-delete (soft-delete retains blobUrl for recovery).
    // Hard-delete returns the pre-deletion row with deletedAt: null; soft-delete sets it.
    if (!vid.deletedAt) {
      cleanupVideoS3Assets(vid).catch((error) =>
        logError('videos.deleteVideo.s3Cleanup', error, {
          feature: 'videos',
          extra: { videoId: vid.id },
        })
      );
    }
  }

  return result;
};

/**
 * Result type for deleteVideo
 */
export type DeleteVideoResult = Awaited<ReturnType<typeof deleteVideo>>;
