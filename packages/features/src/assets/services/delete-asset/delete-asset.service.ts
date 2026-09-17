import { asset, withOrgScope } from '@borradh-workspace/database';
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
  logAuditEvent,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type DeleteAssetInput,
  deleteAssetInputSchema,
} from './delete-asset.schema.js';

/**
 * Internal implementation of delete asset
 */
const deleteAssetImpl = async (
  db: DbConnection,
  input: DeleteAssetInput
): Promise<Result<typeof result | null>> => {
  // Validate input
  const parsed = deleteAssetInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  if (!(await isFeatureOn('killswitch-soft-deletes'))) {
    const [deleted] = await db
      .delete(asset)
      .where(
        and(
          eq(asset.id, parsed.data.id),
          eq(asset.organizationId, parsed.data.organizationId)
        )
      )
      .returning();
    // Fire-and-forget S3 cleanup on hard-delete
    if (deleted?.blobUrl) {
      const s3Info = parseS3Url(deleted.blobUrl);
      if (s3Info) {
        deleteObject({ bucket: s3Info.bucket, key: s3Info.key }).catch(
          (error) => {
            logError('assets.deleteAsset.s3Cleanup', error, {
              feature: 'assets',
              extra: { assetId: deleted.id, blobUrl: deleted.blobUrl },
            });
          }
        );
      }
    }
    return ok(deleted ?? null);
  }

  const [result] = await withOrgScope(
    (tx) =>
      tx
        .update(asset)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(asset.id, parsed.data.id),
            eq(asset.organizationId, parsed.data.organizationId),
            notDeleted(asset)
          )
        )
        .returning(),
    { db }
  );

  if (result) {
    logAuditEvent(db, {
      action: 'delete',
      entityType: 'asset',
      entityId: result.id,
      actorType: 'user',
      actorId: parsed.data.actorId ?? null,
      organizationId: result.organizationId,
    }).catch((error) => {
      logError('assets.deleteAsset.auditLog', error, {
        feature: 'assets',
        extra: { assetId: result.id, organizationId: result.organizationId },
      });
    });
    // S3 cleanup deferred to hard-purge: soft-deleted assets retain their blobUrl
  }

  return ok(result ?? null);
};

/**
 * Delete an asset by ID
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Delete asset input with asset ID and organization ID
 * @returns Result with deleted asset or null if not found
 */
export const deleteAsset = (db: DbConnection, input: DeleteAssetInput) =>
  trackedResult('assets.deleteAsset', () => deleteAssetImpl(db, input), {
    properties: { assetId: input.id, organizationId: input.organizationId },
  });

/**
 * Result type for deleteAsset
 */
export type DeleteAssetResult = Awaited<ReturnType<typeof deleteAsset>>;
