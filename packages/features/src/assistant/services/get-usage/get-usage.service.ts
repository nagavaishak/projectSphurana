import { withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { sql } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { type GetUsageInput, getUsageSchema } from './get-usage.schema.js';

export interface AssistantUsage {
  daily: number;
  monthly: number;
}

const getUsageImpl = async (
  db: DbConnection,
  input: GetUsageInput
): Promise<Result<AssistantUsage>> => {
  const parsed = getUsageSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const now = new Date();
  const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  try {
    const [dailyResult, monthlyResult] = await withOrgScope(
      (tx) =>
        Promise.all([
          tx.execute<{ message_count: number }>(sql`
          SELECT message_count FROM assistant_usage
          WHERE organization_id = ${organizationId} AND date = ${today}
        `),
          tx.execute<{ total: number }>(sql`
          SELECT COALESCE(SUM(message_count), 0)::int AS total
          FROM assistant_usage
          WHERE organization_id = ${organizationId} AND date >= ${firstOfMonth}
        `),
        ]),
      { db }
    );

    return ok({
      daily: dailyResult[0]?.message_count ?? 0,
      monthly: monthlyResult[0]?.total ?? 0,
    });
  } catch (error) {
    logError('assistant.getUsage', error, {
      feature: 'assistant',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to retrieve usage data'
      )
    );
  }
};

export const getAssistantUsage = (db: DbConnection, input: GetUsageInput) =>
  trackedResult('assistant.getUsage', () => getUsageImpl(db, input), {
    properties: { organizationId: input.organizationId },
  });
