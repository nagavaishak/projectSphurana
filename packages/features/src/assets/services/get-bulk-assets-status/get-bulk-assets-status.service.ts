import {
  type AssetUploadBatch,
  asset,
  assetAnalysis,
  assetUploadBatch,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type GetBulkAssetsStatusInput,
  getBulkAssetsStatusInputSchema,
} from './get-bulk-assets-status.schema.js';

/**
 * Asset with analysis status
 */
export interface AssetWithStatus {
  id: string;
  name: string;
  type: string;
  blobUrl: string;
  /**
   * The tags the analysis worker persisted onto the asset row. Returned here
   * so a caller tracking a batch can render finished tags from the same poll
   * that told it the analysis finished, instead of following up with one
   * `GET /assets/:id/analysis` per asset.
   */
  tags: string[];
  analysisStatus: string | null;
  analysisId: string | null;
}

/**
 * Summary of bulk assets status
 */
export interface BulkAssetsStatusSummary {
  total: number;
  videosTotal: number;
  analysisQueued: number;
  analysisProcessing: number;
  analysisCompleted: number;
  analysisFailed: number;
  analysisPending: number;
}

/**
 * Response type for get bulk assets status
 */
export interface GetBulkAssetsStatusResponse {
  batch: AssetUploadBatch | null;
  assets: AssetWithStatus[];
  summary: BulkAssetsStatusSummary;
}

/**
 * Internal implementation of get bulk assets status
 */
const getBulkAssetsStatusImpl = async (
  db: DbConnection,
  input: GetBulkAssetsStatusInput
): Promise<
  | { success: true; data: GetBulkAssetsStatusResponse }
  | { success: false; error: FeatureError }
> => {
  // Validate input
  const parsed = getBulkAssetsStatusInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, batchId, assetIds } = parsed.data;

  return withOrgScope(
    async (tx) => {
      let batch: AssetUploadBatch | null = null;
      let assets: Array<{
        id: string;
        name: string;
        type: 'video' | 'image';
        blobUrl: string;
        tags: string[];
      }> = [];

      // Query by batchId or assetIds
      if (batchId) {
        // Get batch record
        batch =
          (await tx.query.assetUploadBatch.findFirst({
            where: and(
              eq(assetUploadBatch.id, batchId),
              eq(assetUploadBatch.organizationId, organizationId)
            ),
          })) ?? null;

        if (!batch) {
          return err(
            new FeatureError(ErrorCodes.NOT_FOUND, 'Batch not found', {
              batchId,
            })
          );
        }

        // Get all assets in the batch
        assets = await tx.query.asset.findMany({
          where: and(
            eq(asset.batchId, batchId),
            eq(asset.organizationId, organizationId),
            notDeleted(asset)
          ),
        });
      } else if (assetIds && assetIds.length > 0) {
        // Get specific assets
        assets = await tx.query.asset.findMany({
          where: and(
            inArray(asset.id, assetIds),
            eq(asset.organizationId, organizationId),
            notDeleted(asset)
          ),
        });
      }

      // Get analysis records for all assets
      const assetIdList = assets.map((a) => a.id);
      let analysisRecords: Array<{
        id: string;
        assetId: string;
        status: string;
      }> = [];
      if (assetIdList.length > 0) {
        analysisRecords = await tx.query.assetAnalysis.findMany({
          where: inArray(assetAnalysis.assetId, assetIdList),
        });
      }

      // Create a map of assetId -> analysis
      const analysisMap = new Map<
        string,
        { id: string; assetId: string; status: string }
      >();
      for (const record of analysisRecords) {
        analysisMap.set(record.assetId, record);
      }

      // Build response with analysis status
      const assetsWithStatus: AssetWithStatus[] = assets.map((a) => {
        const analysis = analysisMap.get(a.id);
        return {
          id: a.id,
          name: a.name,
          type: a.type,
          blobUrl: a.blobUrl,
          tags: a.tags,
          analysisStatus: analysis?.status ?? null,
          analysisId: analysis?.id ?? null,
        };
      });

      // Calculate summary
      const videoAssets = assets.filter((a) => a.type === 'video');
      const summary: BulkAssetsStatusSummary = {
        total: assets.length,
        videosTotal: videoAssets.length,
        analysisQueued: 0,
        analysisProcessing: 0,
        analysisCompleted: 0,
        analysisFailed: 0,
        analysisPending: 0,
      };

      for (const videoAsset of videoAssets) {
        const analysis = analysisMap.get(videoAsset.id);
        if (!analysis) {
          summary.analysisPending++;
        } else {
          switch (analysis.status) {
            case 'queued':
              summary.analysisQueued++;
              break;
            case 'processing':
              summary.analysisProcessing++;
              break;
            case 'completed':
              summary.analysisCompleted++;
              break;
            case 'failed':
              summary.analysisFailed++;
              break;
          }
        }
      }

      return ok({
        batch,
        assets: assetsWithStatus,
        summary,
      });
    },
    { db }
  );
};

/**
 * Get status of multiple assets (by batch or IDs)
 *
 * @param db - Database connection
 * @param input - Query input (batchId or assetIds)
 * @returns Result with status of all assets and summary
 */
export const getBulkAssetsStatus = (
  db: DbConnection,
  input: GetBulkAssetsStatusInput
) =>
  trackedResult(
    'assets.getBulkAssetsStatus',
    () => getBulkAssetsStatusImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        batchId: input.batchId,
        assetIdsCount: input.assetIds?.length,
      },
      internalErrorsOnly: true,
    }
  );

/**
 * Result type for getBulkAssetsStatus
 */
export type GetBulkAssetsStatusResult = Awaited<
  ReturnType<typeof getBulkAssetsStatus>
>;
