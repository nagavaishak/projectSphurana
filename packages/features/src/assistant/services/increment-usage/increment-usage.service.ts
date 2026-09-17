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
import {
  type IncrementUsageInput,
  incrementUsageSchema,
} from './increment-usage.schema.js';

const incrementUsageImpl = async (
  db: DbConnection,
  input: IncrementUsageInput
): Promise<Result<{ messageCount: number }>> => {
  const parsed = incrementUsageSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  try {
    const result = await withOrgScope(
      (tx) =>
        tx.execute<{ message_count: number }>(sql`
        INSERT INTO assistant_usage (id, organization_id, date, message_count)
        VALUES (gen_random_uuid(), ${organizationId}, ${today}, 1)
        ON CONFLICT ON CONSTRAINT unique_assistant_usage_org_date
        DO UPDATE SET message_count = assistant_usage.message_count + 1
        RETURNING message_count
      `),
      { db }
    );

    return ok({ messageCount: result[0]?.message_count ?? 1 });
  } catch (error) {
    logError('assistant.incrementUsage', error, {
      feature: 'assistant',
      extra: { organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to increment usage')
    );
  }
};

export const incrementAssistantUsage = (
  db: DbConnection,
  input: IncrementUsageInput
) =>
  trackedResult(
    'assistant.incrementUsage',
    () => incrementUsageImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );
