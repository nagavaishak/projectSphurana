// NOTE (RLS W-SYS flag): runOperationalSnapshotCron and buildOperationalSnapshot
// are nightly cron jobs — they scan ALL orgs and write knowledge_entry rows
// across org boundaries. Must be invoked with withSystemScope (BYPASSRLS) by
// the scheduler. W-SYS to wire at the call site in claire-triggers.scheduler.service.ts.
import { lead, sql } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { type DbConnection, type Result, ok } from '../../../shared/index.js';
import type { TriggerOutcome } from '../../triggers/_shared.js';
import { buildOperationalSnapshot } from './build-operational-snapshot.service.js';

/**
 * Nightly cron entry point — iterates qualifying organizations and calls
 * `buildOperationalSnapshot` for each. Per-org failures are isolated so one
 * org's snapshot blowing up doesn't kill the rest of the run.
 *
 * The scheduler service in `apps/api/src/scheduler/claire-triggers.scheduler.service.ts`
 * (W-C13-operational-snapshots — added at 04:30 UTC) wraps this in the same
 * Redis-distributed-lock shape every other Claire trigger uses. Locks the
 * snapshot run to ~15 minutes (longer than the 30s default — embedding
 * generation per org takes ~200ms but we batch 10 at a time, so a 200-org
 * run takes ~4 minutes worst case).
 *
 * Qualifying orgs = any org with a `lead` row. We deliberately don't gate
 * on "active subscription" (the brief mentioned it but the codebase has no
 * single-source-of-truth subscription column on `organization`); empty-state
 * orgs that somehow slip through produce a "Nothing to report" snapshot,
 * which is harmless and cheap. The lead-existence filter is enough to keep
 * the run bounded for hundreds of stale-shell orgs.
 *
 * Returns `Result<TriggerOutcome>` so the scheduler's existing `run()` helper
 * (which is typed against the established trigger shape) can consume it
 * without bespoke wiring.
 */

const BATCH_SIZE = 10;

const runOperationalSnapshotCronImpl = async (
  db: DbConnection
): Promise<Result<TriggerOutcome>> => {
  // Distinct orgs that have any lead — broad-but-cheap qualifier. The set is
  // expected to grow slowly (≪ 10k orgs) so a single SELECT DISTINCT is fine.
  const qualifyingRows = await db.execute<{ id: string }>(sql`
    SELECT DISTINCT ${lead.organizationId} AS id
    FROM ${lead}
  `);

  // postgres-js + drizzle return the rows directly; cast through unknown to
  // keep the test mocks shape-flexible.
  const orgIds = (qualifyingRows as unknown as { id: string }[]).map(
    (r) => r.id
  );

  let created = 0;
  let skipped = 0;
  let failed = 0;

  // Process in batches of BATCH_SIZE so a slow OpenAI call doesn't backpressure
  // the entire run. Each batch is sequential within itself; we keep total
  // concurrency low because embedding generation is rate-limited by OpenAI.
  for (let i = 0; i < orgIds.length; i += BATCH_SIZE) {
    const batch = orgIds.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map((organizationId) =>
        buildOperationalSnapshot(db, { organizationId })
      )
    );

    for (let j = 0; j < settled.length; j++) {
      const outcome = settled[j];
      const orgId = batch[j];
      if (outcome.status === 'rejected') {
        failed += 1;
        logError(
          'assistant.runOperationalSnapshotCron.unhandled',
          outcome.reason instanceof Error
            ? outcome.reason
            : new Error(String(outcome.reason)),
          { feature: 'assistant', extra: { organizationId: orgId } }
        );
        continue;
      }

      const result = outcome.value;
      if (!result.success) {
        failed += 1;
        continue;
      }

      if (result.data.knowledgeEntryId === null) {
        // Skipped (embedding_failed / insert_failed) — already logged inside
        // the service via `logError`. Don't log twice.
        skipped += 1;
      } else {
        created += 1;
      }
    }
  }

  return ok({ created, skipped, failed });
};

export const runOperationalSnapshotCron = (db: DbConnection) =>
  trackedResult(
    'assistant.runOperationalSnapshotCron',
    () => runOperationalSnapshotCronImpl(db),
    { internalErrorsOnly: true }
  );
