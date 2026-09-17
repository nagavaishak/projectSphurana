import { randomUUID } from 'node:crypto';
import { type Asset, asset, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { AssetThumbnailJobPayload } from '../backfill-asset-thumbnails/backfill-asset-thumbnails.schema.js';
import { getAssetThumbnailQueue } from '../backfill-asset-thumbnails/backfill-asset-thumbnails.service.js';
import type { AssetProbeJobPayload } from '../probe-asset/probe-asset.schema.js';
import { getAssetProbeQueue } from '../probe-asset/probe-asset.service.js';
import {
  type CreateAssetInput,
  createAssetInputSchema,
} from './create-asset.schema.js';

/**
 * Internal implementation of create asset
 */
const createAssetImpl = async (
  db: DbConnection,
  input: CreateAssetInput
): Promise<Result<Asset>> => {
  // Validate input
  const parsed = createAssetInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Create asset with generated ID
  const [result] = await withOrgScope(
    (tx) =>
      tx
        .insert(asset)
        .values({
          id: randomUUID(),
          name: parsed.data.name,
          blobUrl: parsed.data.blobUrl,
          sourceFileName: parsed.data.sourceFileName,
          tags: [
            ...new Set(parsed.data.tags.map((t) => t.trim().toLowerCase())),
          ],
          clientName: parsed.data.clientName,
          type: parsed.data.type,
          source: parsed.data.source,
          placeholderTypes: parsed.data.placeholderTypes,
          duration: parsed.data.duration,
          width: parsed.data.width,
          height: parsed.data.height,
          transcript: parsed.data.transcript,
          capturedAt: parsed.data.capturedAt
            ? new Date(parsed.data.capturedAt)
            : undefined,
          organizationId: parsed.data.organizationId,
          uploadedById: parsed.data.uploadedById,
          batchId: parsed.data.batchId,
          // New video uploads start in 'pending' so the probe → transcode
          // pipeline runs. The schema default is 'skipped' so existing rows
          // at migration time don't lock users out of queueVideoExport.
          transcodeStatus: parsed.data.type === 'video' ? 'pending' : 'skipped',
        })
        .returning(),
    { db }
  );

  // Queue thumbnail generation for video assets
  if (result.type === 'video') {
    try {
      const queue = getAssetThumbnailQueue();
      await queue.add(
        'generate-thumbnail',
        {
          assetId: result.id,
          organizationId: result.organizationId,
          blobUrl: result.blobUrl,
        } satisfies AssetThumbnailJobPayload,
        { jobId: `thumb-${result.id}-${Date.now()}` }
      );
    } catch (error) {
      // Don't fail asset creation if thumbnail enqueue fails
      logError('assets.createAsset.enqueueThumbnail', error, {
        feature: 'assets',
        extra: { assetId: result.id },
      });
    }

    // Queue ffprobe job — populates codec/width/height/bitrate and, if needed,
    // cascades into the transcode queue. Must not block asset creation.
    try {
      const probeQueue = getAssetProbeQueue();
      await probeQueue.add(
        'probe-asset',
        {
          assetId: result.id,
          organizationId: result.organizationId,
          blobUrl: result.blobUrl,
        } satisfies AssetProbeJobPayload,
        { jobId: `probe-${result.id}-${Date.now()}` }
      );
    } catch (error) {
      logError('assets.createAsset.enqueueProbe', error, {
        feature: 'assets',
        extra: { assetId: result.id },
      });
    }
  }

  return ok(result);
};

/**
 * Create a new asset
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Asset creation input
 * @returns Result with created asset or error
 */
export const createAsset = (db: DbConnection, input: CreateAssetInput) =>
  trackedResult('assets.createAsset', () => createAssetImpl(db, input), {
    properties: { organizationId: input.organizationId },
  });

/**
 * Result type for createAsset
 */
export type CreateAssetResult = Awaited<ReturnType<typeof createAsset>>;
