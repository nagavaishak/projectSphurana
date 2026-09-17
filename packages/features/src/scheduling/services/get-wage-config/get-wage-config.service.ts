import {
  type PractitionerWageConfig,
  practitioner,
  practitionerWageConfig,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetWageConfigInput,
  getWageConfigSchema,
} from './get-wage-config.schema.js';

/**
 * Get a practitioner's wage config, creating the default row on first read
 * (upsert-on-read, contract §3.5).
 */
const getWageConfigImpl = async (
  db: DbConnection,
  input: GetWageConfigInput
): Promise<Result<PractitionerWageConfig>> => {
  const parsed = getWageConfigSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, practitionerId } = parsed.data;

  try {
    const existing = await db.query.practitionerWageConfig.findFirst({
      where: and(
        eq(practitionerWageConfig.practitionerId, practitionerId),
        eq(practitionerWageConfig.organizationId, organizationId)
      ),
    });

    if (existing) {
      return ok(existing);
    }

    // Verify the practitioner belongs to this org before creating defaults.
    const prac = await db.query.practitioner.findFirst({
      where: and(
        eq(practitioner.id, practitionerId),
        eq(practitioner.organizationId, organizationId)
      ),
    });

    if (!prac) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Practitioner not found')
      );
    }

    const [created] = await db
      .insert(practitionerWageConfig)
      .values({ practitionerId, organizationId })
      .onConflictDoNothing()
      .returning();

    if (created) {
      return ok(created);
    }

    // Concurrent creation — read back the winner.
    //
    // Scoped to the organization, like every other read here. The primary key
    // is `practitioner_id` ALONE, so an insert also conflicts when a config
    // exists for this practitioner under a DIFFERENT organization — and an
    // unscoped read-back would then hand back that other organization's pay
    // rates. It reached this branch precisely because the org-scoped read
    // above found nothing, so an unscoped one succeeding is the bad case, not
    // the good one.
    const raced = await db.query.practitionerWageConfig.findFirst({
      where: and(
        eq(practitionerWageConfig.practitionerId, practitionerId),
        eq(practitionerWageConfig.organizationId, organizationId)
      ),
    });
    if (raced) {
      return ok(raced);
    }

    // Nothing readable after a conflict means a row exists for this
    // practitioner under another organization. Log it — this previously
    // returned INTERNAL_ERROR with no diagnostic at all, so the resulting 500
    // was untraceable.
    logError(
      'scheduling.getWageConfig',
      new Error(
        'Wage config insert conflicted but no row is readable for this organization'
      ),
      {
        feature: 'scheduling',
        extra: { organizationId, practitionerId },
      }
    );

    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to get wage config')
    );
  } catch (error) {
    logError('scheduling.getWageConfig', error, {
      feature: 'scheduling',
      extra: { organizationId, practitionerId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to get wage config')
    );
  }
};

export const getWageConfig = (db: DbConnection, input: GetWageConfigInput) =>
  trackedResult(
    'scheduling.getWageConfig',
    () => withOrgScope((tx) => getWageConfigImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        practitionerId: input.practitionerId,
      },
      internalErrorsOnly: true,
    }
  );

export type GetWageConfigResult = Awaited<ReturnType<typeof getWageConfig>>;
