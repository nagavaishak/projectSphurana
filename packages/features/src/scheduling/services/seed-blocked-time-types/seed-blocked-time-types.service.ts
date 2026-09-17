import {
  type BlockedTimeType,
  blockedTimeType,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  BLOCKED_TIME_TYPE_PRESETS,
  type SeedBlockedTimeTypesInput,
  seedBlockedTimeTypesSchema,
} from './seed-blocked-time-types.schema.js';

/**
 * Idempotently seed the preset blocked-time types (Lunch/Training/Meeting)
 * for an org — insert-if-missing by name. Called from the org-creation flow
 * and run once as a backfill for existing orgs at integration.
 */
const seedBlockedTimeTypesImpl = async (
  db: DbConnection,
  input: SeedBlockedTimeTypesInput
): Promise<Result<{ created: BlockedTimeType[] }>> => {
  const parsed = seedBlockedTimeTypesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  try {
    const existing = await db
      .select()
      .from(blockedTimeType)
      .where(eq(blockedTimeType.organizationId, organizationId));

    const existingNames = new Set(existing.map((t) => t.name));
    const missing = BLOCKED_TIME_TYPE_PRESETS.filter(
      (preset) => !existingNames.has(preset.name)
    );

    if (missing.length === 0) {
      return ok({ created: [] });
    }

    const created = await db
      .insert(blockedTimeType)
      .values(missing.map((preset) => ({ organizationId, ...preset })))
      .onConflictDoNothing()
      .returning();

    return ok({ created });
  } catch (error) {
    logError('scheduling.seedBlockedTimeTypes', error, {
      feature: 'scheduling',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to seed blocked time types'
      )
    );
  }
};

export const seedBlockedTimeTypes = (
  db: DbConnection,
  input: SeedBlockedTimeTypesInput
) =>
  trackedResult(
    'scheduling.seedBlockedTimeTypes',
    () => withOrgScope((tx) => seedBlockedTimeTypesImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type SeedBlockedTimeTypesResult = Awaited<
  ReturnType<typeof seedBlockedTimeTypes>
>;
