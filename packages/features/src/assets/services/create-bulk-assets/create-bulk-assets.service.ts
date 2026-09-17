import { randomUUID } from 'node:crypto';
import {
  type Asset,
  type AssetUploadBatch,
  asset,
  assetAnalysis,
  assetUploadBatch,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  ok,
} from '../../../shared/index.js';
import { ANALYSIS_PRIORITY } from '../queue-asset-analysis/queue-asset-analysis.schema.js';
import { getAssetAnalysisQueue } from '../queue-asset-analysis/queue-asset-analysis.service.js';
import {
  type CreateBulkAssetsInput,
  createBulkAssetsInputSchema,
} from './create-bulk-assets.schema.js';

/**
 * Response type for create bulk assets
 */
export interface CreateBulkAssetsResponse {
  batch: AssetUploadBatch;
  assets: Asset[];
  analysisQueued: number;
}

/**
 * Internal implementation of create bulk assets
 */
const createBulkAssetsImpl = async (
  db: DbConnection,
  input: CreateBulkAssetsInput
): Promise<
  | { success: true; data: CreateBulkAssetsResponse }
  | { success: false; error: FeatureError }
> => {
  // Validate input
  const parsed = createBulkAssetsInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    assets: assetInputs,
    organizationId,
    uploadedById,
    autoAnalyze,
  } = parsed.data;

  const batchId = randomUUID();
  const now = new Date();

  try {
    // Use a real transaction for atomicity (preserved whether or not RLS is on).
    // withOrgScope binds the org context around it when RLS_ENABLED; when off it
    // passes `db` straight through so the transaction still runs.
    const result = await withOrgScope(
      (scopedDb) =>
        scopedDb.transaction(async (tx) => {
          // 1. Create the batch record
          const [batch] = await tx
            .insert(assetUploadBatch)
            .values({
              id: batchId,
              totalAssets: assetInputs.length,
              completedAssets: 0,
              failedAssets: 0,
              status: 'processing',
              organizationId,
              createdById: uploadedById,
              createdAt: now,
              updatedAt: now,
            })
            .returning();

          // 2. Prepare asset records with generated IDs
          const assetRecords = assetInputs.map((assetInput) => ({
            id: randomUUID(),
            name: assetInput.name,
            blobUrl: assetInput.blobUrl,
            sourceFileName: assetInput.sourceFileName,
            tags: assetInput.tags,
            clientName: assetInput.clientName,
            type: assetInput.type,
            placeholderTypes: assetInput.placeholderTypes,
            duration: assetInput.duration,
            width: assetInput.width,
            height: assetInput.height,
            transcript: assetInput.transcript,
            organizationId,
            uploadedById,
            batchId,
            createdAt: now,
            updatedAt: now,
          }));

          // 3. Bulk insert all assets
          const createdAssets = await tx
            .insert(asset)
            .values(assetRecords)
            .returning();

          return { batch, assets: createdAssets };
        }),
      { db }
    );

    // 4. Queue analysis for video assets (best effort - outside transaction)
    let analysisQueued = 0;
    if (autoAnalyze) {
      const videoAssets = result.assets.filter((a) => a.type === 'video');
      if (videoAssets.length > 0) {
        try {
          const queue = getAssetAnalysisQueue();

          // Create analysis records and queue jobs
          for (const videoAsset of videoAssets) {
            try {
              // Create analysis record
              const [analysis] = await withOrgScope(
                (tx) =>
                  tx
                    .insert(assetAnalysis)
                    .values({
                      assetId: videoAsset.id,
                      status: 'queued',
                    })
                    .returning(),
                { db }
              );

              // Add job to queue
              await queue.add(
                'analyze',
                {
                  assetId: videoAsset.id,
                  organizationId,
                  analysisId: analysis.id,
                },
                {
                  jobId: `analysis-${videoAsset.id}-${Date.now()}`,
                  priority: ANALYSIS_PRIORITY.LOW, // Batch uploads get low priority
                }
              );

              analysisQueued++;
            } catch (error) {
              // Log but don't fail - analysis can be triggered manually later
              logError('assets.createBulkAssets.queueAnalysis', error, {
                feature: 'assets',
                extra: { assetId: videoAsset.id, batchId },
              });
            }
          }
        } catch (error) {
          // Queue connection issue - log but don't fail
          logError('assets.createBulkAssets.queueConnection', error, {
            feature: 'assets',
            extra: { batchId, videoCount: videoAssets.length },
          });
        }
      }
    }

    // 5. Update batch status to completed
    await withOrgScope(
      (tx) =>
        tx
          .update(assetUploadBatch)
          .set({
            status: 'completed',
            completedAssets: result.assets.length,
            updatedAt: new Date(),
          })
          .where(eq(assetUploadBatch.id, batchId)),
      { db }
    );

    return ok({
      batch: {
        ...result.batch,
        status: 'completed' as const,
        completedAssets: result.assets.length,
      },
      assets: result.assets,
      analysisQueued,
    });
  } catch (error) {
    logError('assets.createBulkAssets', error, {
      feature: 'assets',
      extra: { batchId, assetCount: assetInputs.length, organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to create assets')
    );
  }
};

/**
 * Create multiple assets in a single batch
 *
 * @param db - Database connection
 * @param input - Bulk asset creation input
 * @returns Result with batch info and created assets
 */
export const createBulkAssets = (
  db: DbConnection,
  input: CreateBulkAssetsInput
) =>
  trackedResult(
    'assets.createBulkAssets',
    () => createBulkAssetsImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        assetCount: input.assets?.length,
      },
    }
  );

/**
 * Result type for createBulkAssets
 */
export type CreateBulkAssetsResult = Awaited<
  ReturnType<typeof createBulkAssets>
>;
