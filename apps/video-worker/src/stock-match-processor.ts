import { initAIClient, isAIClientInitialized } from '@borradh-workspace/ai';
import { withSystemScope } from '@borradh-workspace/database';
// The classifier lives with organization-services because it WRITES
// organization_service; the matcher lives with stock-footage because it reads
// the clip bank. See packages/features/src/architecture/single-writer.test.ts.
import { classifyServiceTechnique } from '@borradh-workspace/features/organization-services';
import {
  STOCK_MATCH_QUEUE,
  type StockMatchJobPayload,
  resolveServiceStockClips,
} from '@borradh-workspace/features/stock-footage';
import { createLogger, logError } from '@borradh-workspace/observability';
import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { type Job, Worker } from 'bullmq';

let log: ReturnType<typeof createLogger>;

const CONCURRENCY = 2;

/**
 * The classifier calls chatCompletion and generateEmbeddings, which need the
 * OpenAI client. The worker only inits the Vision API at startup, so ensure the
 * chat client is up here (idempotent). Mirrors the assistant/knowledge
 * ensureClient pattern.
 */
function ensureAiClient(): void {
  if (isAIClientInitialized()) return;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    log.warn('OPENAI_API_KEY not set — stock matching will fail until set');
    return;
  }
  initAIClient({ apiKey });
}

async function processStockMatchJob(
  job: Job<StockMatchJobPayload>
): Promise<void> {
  const { organizationServiceId, reclassify } = job.data;

  // CLASSIFY, then match. The resolver gates on `technique_slug`, so a service
  // that has never been classified skips the technique branch entirely and
  // lands on the generic ambient pool.
  //
  // Nothing in the application used to write that column — only a hand-run
  // script did — so every service created since the last manual run, including
  // every service of a newly onboarded organisation, was permanently generic.
  // It was invisible because null is a LEGITIMATE classification for a name
  // like "Anti-Ageing": nothing errored, nothing was empty, the videos just
  // never showed the treatment.
  //
  // Best-effort on purpose. A classifier outage must not stop matching — a
  // service still gets ambient clips cached, which is what it would have got
  // anyway. `technique_classified_at` is only written on success, so the next
  // job for this service retries the classification.
  const classified = await withSystemScope((conn) =>
    classifyServiceTechnique(conn, {
      organizationServiceId,
      force: reclassify ?? false,
    })
  );
  if (!classified.success) {
    log.warn(
      `Classification failed for service ${organizationServiceId} (${classified.error.code}) — matching against the existing spec`
    );
  } else if (!classified.data.skipped) {
    log.info(
      `Classified service ${organizationServiceId} as ${
        classified.data.techniqueSlug ?? 'null (vague)'
      } in ${classified.data.passes} pass(es)`
    );
  }

  const result = await withSystemScope((conn) =>
    resolveServiceStockClips(conn, { organizationServiceId })
  );
  if (!result.success) {
    throw new Error(`stock match failed: ${result.error.message}`);
  }
  log.info(
    `Resolved ${result.data.picks.length} stock clips for service ${organizationServiceId}${
      result.data.skipped ? ` (skipped: ${result.data.skipped})` : ''
    }`
  );
}

export function createStockMatchWorker(): Worker<StockMatchJobPayload> {
  log = createLogger('stock-match');
  ensureAiClient();
  const redis = getRedis();
  log.info(`Starting worker with concurrency: ${CONCURRENCY}`);

  const worker = new Worker<StockMatchJobPayload>(
    STOCK_MATCH_QUEUE,
    async (job) => {
      try {
        await processStockMatchJob(job);
      } catch (error) {
        logError('video-worker.stockMatch.processJob', error, {
          feature: 'video-worker',
          extra: {
            jobId: job.id,
            organizationServiceId: job.data.organizationServiceId,
          },
        });
        throw error;
      }
    },
    {
      connection: redis,
      prefix: getBullMqPrefix(),
      concurrency: CONCURRENCY,
      lockDuration: 120000,
      stalledInterval: 60000,
    }
  );

  worker.on('ready', () => {
    log.info('Worker ready and listening for jobs');
  });
  worker.on('completed', (job) => {
    log.info(`Job ${job.id} completed`);
  });
  worker.on('failed', (job, error) => {
    logError('video-worker.stockMatch.jobFailed', error, {
      feature: 'video-worker',
      extra: { jobId: job?.id },
    });
  });
  worker.on('error', (error) => {
    logError('video-worker.stockMatch.workerError', error, {
      feature: 'video-worker',
    });
  });

  return worker;
}

export async function closeStockMatchWorker(
  worker: Worker<StockMatchJobPayload>
): Promise<void> {
  await worker.close();
}
