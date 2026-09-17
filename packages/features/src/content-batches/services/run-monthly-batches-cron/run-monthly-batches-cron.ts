import { member, organization, sql } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { type DbConnection, type Result, ok } from '../../../shared/index.js';
import {
  DEFAULT_BATCH_GRAPHIC_COUNT,
  DEFAULT_BATCH_VIDEO_COUNT,
  generateMonthlyBatch,
} from '../generate-monthly-batch/index.js';

export interface RunMonthlyBatchesCronOutcome {
  /** Orgs that got a brand-new batch this run */
  created: number;
  /** Orgs that already had a batch for this month (idempotent) */
  skipped: number;
  /** Orgs whose batch creation blew up */
  failed: number;
}

/**
 * Monthly cron entry point — iterates qualifying organisations and calls
 * `generateMonthlyBatch` for each. Per-org failures are isolated so one
 * org's render budget hiccup doesn't kill the rest of the run.
 *
 * Scheduling: wire into
 * `apps/api/src/scheduler/scheduler.service.ts` to fire on the 1st of each
 * month (e.g. `0 6 1 * *` UTC). The same Redis-distributed-lock pattern
 * used for other crons applies; the lock TTL should be generous — a 500-org
 * run at 6 graphics + 2 videos each is ~4k render jobs queued and may take 10+
 * minutes end-to-end (the actual rendering happens out-of-band in the
 * video-/graphic-worker BullMQ queues).
 *
 * Qualifying orgs = any org with at least one member. We don't gate on
 * billing state — the brief is "this happens for everyone" — but `member`
 * filters out the empty-shell orgs that otherwise drift around the table.
 *
 * Choice of `createdById`: we pick the org's first member (earliest
 * createdAt) as the assignee. The cron is a system action so technically
 * any user works, but attributing to a real human keeps audit trails
 * useful and avoids a chicken-and-egg "system user" row.
 */
const BATCH_SIZE = 10;

const runMonthlyBatchesCronImpl = async (
  db: DbConnection
): Promise<Result<RunMonthlyBatchesCronOutcome>> => {
  // Distinct orgs that have any member, joined to the earliest member
  // user_id we'll attribute generated content to. SQL is deliberately
  // explicit so it survives drizzle's schema-shape churn — the join is
  // tiny and the org count is bounded.
  const qualifyingRows = await db.execute<{
    org_id: string;
    user_id: string;
  }>(sql`
    SELECT
      o.id AS org_id,
      (
        SELECT m.user_id
        FROM ${member} m
        WHERE m.organization_id = o.id
        ORDER BY m.created_at ASC
        LIMIT 1
      ) AS user_id
    FROM ${organization} o
    WHERE EXISTS (
      SELECT 1 FROM ${member} m2 WHERE m2.organization_id = o.id
    )
  `);

  const rows = (
    qualifyingRows as unknown as {
      org_id: string;
      user_id: string;
    }[]
  ).filter((r) => r.user_id);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map((row) =>
        generateMonthlyBatch(db, {
          organizationId: row.org_id,
          createdById: row.user_id,
          graphicCount: DEFAULT_BATCH_GRAPHIC_COUNT,
          videoCount: DEFAULT_BATCH_VIDEO_COUNT,
          allowStockFootage: false,
        })
      )
    );

    for (let j = 0; j < settled.length; j++) {
      const outcome = settled[j];
      const row = batch[j];
      if (outcome.status === 'rejected') {
        failed += 1;
        logError(
          'contentBatches.runMonthlyBatchesCron.unhandled',
          outcome.reason instanceof Error
            ? outcome.reason
            : new Error(String(outcome.reason)),
          { feature: 'content-batches', extra: { organizationId: row.org_id } }
        );
        continue;
      }

      const result = outcome.value;
      if (!result.success) {
        failed += 1;
        continue;
      }

      if (result.data.alreadyExisted) {
        skipped += 1;
      } else {
        created += 1;
      }
    }
  }

  return ok({ created, skipped, failed });
};

export const runMonthlyBatchesCron = (db: DbConnection) =>
  trackedResult(
    'contentBatches.runMonthlyBatchesCron',
    () => runMonthlyBatchesCronImpl(db),
    { internalErrorsOnly: true }
  );
