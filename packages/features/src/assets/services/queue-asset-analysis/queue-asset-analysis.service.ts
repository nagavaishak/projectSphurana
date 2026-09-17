import { assetAnalysis, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { safeJobId } from '../../../shared/queue/index.js';
import {
  type QueueAssetAnalysisInput,
  queueAssetAnalysisSchema,
} from './queue-asset-analysis.schema.js';

// Queue names
export const ASSET_ANALYSIS_QUEUE = 'asset-analysis';
export const ASSET_ANALYSIS_DLQ = 'asset-analysis-dlq';

// Lazy-initialized queue instance
let analysisQueue: Queue | null = null;

/**
 * Retry configuration for analysis jobs
 */
const RETRY_CONFIG = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 5000, // Start with 5s delay
  },
};

/**
 * Get the asset analysis queue instance
 */
export function getAssetAnalysisQueue(): Queue {
  if (!analysisQueue) {
    analysisQueue = new Queue(ASSET_ANALYSIS_QUEUE, {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: false,
        ...RETRY_CONFIG,
      },
    });
  }
  return analysisQueue;
}

/**
 * Asset analysis job payload
 */
export interface AssetAnalysisJobPayload {
  assetId: string;
  organizationId: string;
  analysisId: string;
}

/**
 * Internal implementation of queue asset analysis
 */
const queueAssetAnalysisImpl = async (
  db: DbConnection,
  input: QueueAssetAnalysisInput
): Promise<Result<typeof assetAnalysis.$inferSelect>> => {
  // Validate input
  const parsed = queueAssetAnalysisSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { assetId, organizationId, priority } = parsed.data;

  // DB work in one org-scoped transaction, queue enqueue after
  const result = await withOrgScope(
    async (tx) => {
      // Verify asset exists and belongs to the organization
      const existingAsset = await tx.query.asset.findFirst({
        where: (a, { eq, and, isNull }) =>
          and(
            eq(a.id, assetId),
            eq(a.organizationId, organizationId),
            isNull(a.deletedAt)
          ),
      });

      if (!existingAsset) {
        return err(
          new FeatureError(ErrorCodes.NOT_FOUND, 'Asset not found', { assetId })
        );
      }

      // Skip analysis for edited/polished assets — tags are only generated for raw footage
      if (existingAsset.source === 'edited') {
        return err(
          new FeatureError(
            ErrorCodes.VALIDATION_ERROR,
            'Analysis is only available for raw footage. Edited/polished assets are skipped.',
            { source: existingAsset.source }
          )
        );
      }

      // Check if an analysis already exists
      const existingAnalysis = await tx.query.assetAnalysis.findFirst({
        where: (aa, { eq: e }) => e(aa.assetId, assetId),
      });

      let analysis: typeof assetAnalysis.$inferSelect;

      if (existingAnalysis) {
        // If already processing, don't re-queue
        if (existingAnalysis.status === 'processing') {
          return err(
            new FeatureError(
              ErrorCodes.CONFLICT,
              'Analysis is already in progress',
              { status: existingAnalysis.status }
            )
          );
        }

        // Update existing analysis to queued status
        const [updated] = await tx
          .update(assetAnalysis)
          .set({
            status: 'queued',
            errorMessage: null,
            queuedAt: new Date(),
            startedAt: null,
            completedAt: null,
          })
          .where(eq(assetAnalysis.id, existingAnalysis.id))
          .returning();

        analysis = updated;
      } else {
        // Create new analysis record
        const [created] = await tx
          .insert(assetAnalysis)
          .values({
            assetId,
            status: 'queued',
          })
          .returning();

        analysis = created;
      }

      return ok(analysis);
    },
    { db }
  );

  if (!result.success) {
    return result;
  }

  const analysis = result.data;

  // Add job to the BullMQ queue (outside transaction — best-effort)
  const queue = getAssetAnalysisQueue();
  await queue.add(
    'analyze',
    {
      assetId,
      organizationId,
      analysisId: analysis.id,
    } satisfies AssetAnalysisJobPayload,
    {
      jobId: safeJobId('analysis', assetId, Date.now()),
      priority,
    }
  );

  return ok(analysis);
};

/**
 * Queue an asset for AI analysis
 *
 * @param db - Database connection
 * @param input - Queue asset analysis input
 * @returns Result with analysis record or error
 */
export const queueAssetAnalysis = (
  db: DbConnection,
  input: QueueAssetAnalysisInput
) =>
  trackedResult(
    'assets.queueAssetAnalysis',
    () => queueAssetAnalysisImpl(db, input),
    {
      properties: {
        assetId: input.assetId,
        organizationId: input.organizationId,
      },
    }
  );

/**
 * Result type for queueAssetAnalysis
 */
export type QueueAssetAnalysisResult = Awaited<
  ReturnType<typeof queueAssetAnalysis>
>;

/**
 * Close the queue connection (for graceful shutdown)
 */
export async function closeAssetAnalysisQueue(): Promise<void> {
  if (analysisQueue) {
    await analysisQueue.close();
    analysisQueue = null;
  }
}
