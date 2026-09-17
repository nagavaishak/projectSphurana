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
  type UpdateWageConfigInput,
  updateWageConfigSchema,
} from './update-wage-config.schema.js';

/**
 * Upsert a practitioner's wage config with a partial patch (contract §3.5).
 */
const updateWageConfigImpl = async (
  db: DbConnection,
  input: UpdateWageConfigInput
): Promise<Result<PractitionerWageConfig>> => {
  const parsed = updateWageConfigSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, practitionerId, ...rest } = parsed.data;

  const patch = Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined)
  );

  try {
    const existing = await db.query.practitionerWageConfig.findFirst({
      where: and(
        eq(practitionerWageConfig.practitionerId, practitionerId),
        eq(practitionerWageConfig.organizationId, organizationId)
      ),
    });

    if (existing) {
      const [updated] = await db
        .update(practitionerWageConfig)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(practitionerWageConfig.practitionerId, practitionerId),
            eq(practitionerWageConfig.organizationId, organizationId)
          )
        )
        .returning();

      return ok(updated);
    }

    // Verify the practitioner belongs to this org before creating the row.
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
      .values({ practitionerId, organizationId, ...patch })
      .returning();

    return ok(created);
  } catch (error) {
    logError('scheduling.updateWageConfig', error, {
      feature: 'scheduling',
      extra: { organizationId, practitionerId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update wage config'
      )
    );
  }
};

export const updateWageConfig = (
  db: DbConnection,
  input: UpdateWageConfigInput
) =>
  trackedResult(
    'scheduling.updateWageConfig',
    () => withOrgScope((tx) => updateWageConfigImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        practitionerId: input.practitionerId,
      },
    }
  );

export type UpdateWageConfigResult = Awaited<
  ReturnType<typeof updateWageConfig>
>;
