import { asset, assetAnalysis } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, notInArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { ANALYSIS_PRIORITY } from '../queue-asset-analysis/queue-asset-analysis.schema.js';
import {
  type AssetAnalysisJobPayload,
  getAssetAnalysisQueue,
} from '../queue-asset-analysis/queue-asset-analysis.service.js';
import {
  type BackfillAssetAnalysisInput,
  backfillAssetAnalysisSchema,
} from './backfill-asset-analysis.schema.js';

const backfillAssetAnalysisImpl = async (
  db: DbConnection,
  input: BackfillAssetAnalysisInput
): Promise<Result<{ queued: number }>> => {
  const parsed = backfillAssetAnalysisSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Get asset IDs that already have an analysis record (plus status/startedAt
  // so we can detect failed / stuck-processing analyses to recover).
  const existingAnalyses = await db
    .select({
      id: assetAnalysis.id,
      assetId: assetAnalysis.assetId,
      status: assetAnalysis.status,
      startedAt: assetAnalysis.startedAt,
    })
    .from(assetAnalysis);
  const analyzedIds = existingAnalyses.map((a) => a.assetId);

  const queue = getAssetAnalysisQueue();
  let queued = 0;

  // Recovery path (ENG-216 / ENG-386): re-enqueue analyses that failed outright
  // or have been stuck in `processing` past the stale threshold (worker died /
  // job lost), so the asset isn't left permanently tag-less and the frontend
  // poll doesn't just time out.
  if (parsed.data.requeueFailed) {
    const staleMinutes = parsed.data.staleProcessingMinutes ?? 30;
    const staleBefore = new Date(Date.now() - staleMinutes * 60_000);

    // Map assetId -> orgId for the recoverable analyses.
    const orgByAsset = new Map<string, string>();
    if (existingAnalyses.length > 0) {
      const assetRows = await db
        .select({ id: asset.id, organizationId: asset.organizationId })
        .from(asset)
        .where(notDeleted(asset));
      for (const row of assetRows) orgByAsset.set(row.id, row.organizationId);
    }

    const recoverable = existingAnalyses.filter((a) => {
      if (parsed.data.organizationId) {
        if (orgByAsset.get(a.assetId) !== parsed.data.organizationId)
          return false;
      }
      if (a.status === 'failed') return true;
      if (a.status === 'processing' && a.startedAt && a.startedAt < staleBefore)
        return true;
      return false;
    });

    for (const a of recoverable) {
      const organizationId = orgByAsset.get(a.assetId);
      if (!organizationId) continue;
      try {
        await db
          .update(assetAnalysis)
          .set({
            status: 'queued',
            errorMessage: null,
            startedAt: null,
            completedAt: null,
          })
          .where(eq(assetAnalysis.id, a.id));

        await queue.add(
          'analyze',
          {
            assetId: a.assetId,
            organizationId,
            analysisId: a.id,
          } satisfies AssetAnalysisJobPayload,
          {
            jobId: `analysis-${a.assetId}-${Date.now()}`,
            priority: ANALYSIS_PRIORITY.LOW,
          }
        );
        queued++;
      } catch (error) {
        logError('assets.backfillAnalysis.requeueFailed', error, {
          feature: 'assets',
          extra: { assetId: a.assetId, analysisId: a.id },
        });
      }
    }
  }

  // Find assets that have no analysis record and are raw source
  const conditions = [eq(asset.source, 'raw'), notDeleted(asset)];
  if (parsed.data.organizationId) {
    conditions.push(eq(asset.organizationId, parsed.data.organizationId));
  }
  if (analyzedIds.length > 0) {
    conditions.push(notInArray(asset.id, analyzedIds));
  }

  const assets = await db
    .select({
      id: asset.id,
      organizationId: asset.organizationId,
    })
    .from(asset)
    .where(and(...conditions));

  if (assets.length === 0) {
    return ok({ queued });
  }

  for (const a of assets) {
    try {
      // Create analysis record
      const [analysis] = await db
        .insert(assetAnalysis)
        .values({ assetId: a.id, status: 'queued' })
        .onConflictDoNothing()
        .returning();

      if (!analysis) continue;

      await queue.add(
        'analyze',
        {
          assetId: a.id,
          organizationId: a.organizationId,
          analysisId: analysis.id,
        } satisfies AssetAnalysisJobPayload,
        {
          jobId: `analysis-${a.id}-${Date.now()}`,
          priority: ANALYSIS_PRIORITY.LOW,
        }
      );
      queued++;
    } catch (error) {
      logError('assets.backfillAnalysis.enqueue', error, {
        feature: 'assets',
        extra: { assetId: a.id },
      });
    }
  }

  return ok({ queued });
};

export const backfillAssetAnalysis = (
  db: DbConnection,
  input: BackfillAssetAnalysisInput
) =>
  trackedResult(
    'assets.backfillAssetAnalysis',
    () => backfillAssetAnalysisImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type BackfillAssetAnalysisResult = Awaited<
  ReturnType<typeof backfillAssetAnalysis>
>;
