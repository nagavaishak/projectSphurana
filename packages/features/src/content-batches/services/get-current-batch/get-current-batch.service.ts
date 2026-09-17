import { contentBatch, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  type ErrorCode,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { type GetBatchResponse, getBatch } from '../get-batch/index.js';
import {
  type GetCurrentBatchInput,
  getCurrentBatchSchema,
} from './get-current-batch.schema.js';

/**
 * Resolve the "current" batch for an organisation — i.e. the batch for the
 * UTC month the caller is in. Returns NOT_FOUND if the cron hasn't run yet
 * for this org/month; the Socials page treats that as "no batch this month
 * yet" and surfaces the appropriate empty state.
 *
 * Delegates hydration of items + assets to `getBatch` so there's exactly
 * one place to maintain the shape of "batch + items" responses.
 */
const getCurrentBatchImpl = async (
  db: DbConnection,
  input: GetCurrentBatchInput
): Promise<Result<GetBatchResponse>> => {
  const parsed = getCurrentBatchSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // "Current" is the most recently created batch, NOT the one matching this
  // calendar month. Batches are made on demand — owners click generate roughly
  // weekly — so a month-keyed lookup would 404 the batch they just made if the
  // month had rolled over, and hide a batch made last month that is still in
  // review. `periodMonth` remains supported as an explicit filter.
  const periodMonth = parsed.data.periodMonth;

  const batch = await withOrgScope(
    (tx) =>
      tx.query.contentBatch.findFirst({
        where: periodMonth
          ? and(
              eq(contentBatch.organizationId, parsed.data.organizationId),
              eq(contentBatch.periodMonth, periodMonth)
            )
          : eq(contentBatch.organizationId, parsed.data.organizationId),
        orderBy: (b, { desc }) => [desc(b.createdAt)],
        columns: { id: true },
      }),
    { db }
  );

  if (!batch) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        periodMonth
          ? `No content batch for period ${periodMonth}`
          : 'No content batch yet'
      )
    );
  }

  // getBatch is `trackedResult`-wrapped so its return shape is the plain
  // ResultShape; re-wrap the error as a FeatureError so this function's
  // declared `Result<T>` return type holds.
  const inner = await getBatch(db, {
    id: batch.id,
    organizationId: parsed.data.organizationId,
  });
  if (!inner.success) {
    return err(
      new FeatureError(
        inner.error.code as ErrorCode,
        inner.error.message,
        inner.error.details
      )
    );
  }
  return ok(inner.data);
};

export const getCurrentBatch = (
  db: DbConnection,
  input: GetCurrentBatchInput
) =>
  trackedResult(
    'contentBatches.getCurrentBatch',
    () => getCurrentBatchImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type GetCurrentBatchResult = Awaited<ReturnType<typeof getCurrentBatch>>;
