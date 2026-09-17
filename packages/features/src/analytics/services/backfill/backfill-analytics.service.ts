import { trackedResult } from '@borradh-workspace/observability';
import { logError } from '@borradh-workspace/observability';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import type { DbConnection, Result } from '../../../shared/index.js';
import { exportSnapshots } from '../export-snapshots/index.js';
import {
  type BackfillAnalyticsInput,
  backfillAnalyticsSchema,
} from './backfill-analytics.schema.js';

interface BackfillResult {
  daysProcessed: number;
  errors: string[];
}

const backfillAnalyticsImpl = async (
  db: DbConnection,
  input: BackfillAnalyticsInput
): Promise<Result<BackfillResult>> => {
  const parsed = backfillAnalyticsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { from, to } = parsed.data;
  const errors: string[] = [];
  let daysProcessed = 0;

  const current = new Date(from);
  while (current <= to) {
    try {
      const result = await exportSnapshots(db, { date: new Date(current) });
      if (result.success && result.data.failed.length > 0) {
        errors.push(
          `${current.toISOString().split('T')[0]}: failed domains: ${result.data.failed.join(', ')}`
        );
      }
      daysProcessed++;
    } catch (error) {
      const dateStr = current.toISOString().split('T')[0] ?? '';
      logError('analytics.backfill', error, {
        feature: 'analytics',
        extra: { date: dateStr },
      });
      errors.push(
        `${dateStr}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
    current.setDate(current.getDate() + 1);
  }

  return ok({ daysProcessed, errors });
};

export const backfillAnalytics = (
  db: DbConnection,
  input: BackfillAnalyticsInput
) =>
  trackedResult('analytics.backfill', () => backfillAnalyticsImpl(db, input), {
    properties: {
      from: input.from.toISOString(),
      to: input.to.toISOString(),
    },
  });

export type { BackfillResult };
