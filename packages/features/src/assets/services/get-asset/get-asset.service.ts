import { asset, user, withOrgScope } from '@borradh-workspace/database';
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
import { type GetAssetInput, getAssetInputSchema } from './get-asset.schema.js';

/**
 * Internal implementation of get asset
 */
const getAssetImpl = async (
  db: DbConnection,
  input: GetAssetInput
): Promise<Result<typeof result | null>> => {
  // Validate input
  const parsed = getAssetInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const [result] = await withOrgScope(
    (tx) =>
      tx
        .select({
          id: asset.id,
          name: asset.name,
          blobUrl: asset.blobUrl,
          thumbnailUrl: asset.thumbnailUrl,
          sourceFileName: asset.sourceFileName,
          tags: asset.tags,
          clientName: asset.clientName,
          type: asset.type,
          duration: asset.duration,
          width: asset.width,
          height: asset.height,
          transcript: asset.transcript,
          organizationId: asset.organizationId,
          uploadedById: asset.uploadedById,
          createdAt: asset.createdAt,
          updatedAt: asset.updatedAt,
          uploader: {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
          },
        })
        .from(asset)
        .leftJoin(user, eq(asset.uploadedById, user.id))
        .where(
          and(
            eq(asset.id, parsed.data.id),
            eq(asset.organizationId, parsed.data.organizationId),
            notDeleted(asset)
          )
        )
        .limit(1),
    { db }
  );

  return ok(result ?? null);
};

/**
 * Get a single asset by ID
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Get asset input with asset ID and organization ID
 * @returns Result with asset or null if not found
 */
export const getAsset = (db: DbConnection, input: GetAssetInput) =>
  trackedResult('assets.getAsset', () => getAssetImpl(db, input), {
    properties: { assetId: input.id, organizationId: input.organizationId },
    internalErrorsOnly: true,
  });

/**
 * Result type for getAsset
 */
export type GetAssetResult = Awaited<ReturnType<typeof getAsset>>;
