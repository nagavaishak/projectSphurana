import { practitioner, withOrgScope } from '@borradh-workspace/database';
import type { Practitioner } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type CompletePractitionerProfileSetupInput,
  completePractitionerProfileSetupSchema,
} from './complete-practitioner-profile-setup.schema.js';

const completePractitionerProfileSetupImpl = async (
  db: DbConnection,
  input: CompletePractitionerProfileSetupInput
): Promise<Result<Practitioner>> => {
  const parsed = completePractitionerProfileSetupSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { practitionerId, organizationId } = parsed.data;

  try {
    const [updated] = await db
      .update(practitioner)
      .set({ profileSetupCompleted: true })
      .where(
        and(
          eq(practitioner.id, practitionerId),
          eq(practitioner.organizationId, organizationId),
          notDeleted(practitioner)
        )
      )
      .returning();

    if (!updated) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Practitioner not found')
      );
    }

    return ok(updated);
  } catch (error) {
    logError('practitioners.completePractitionerProfileSetup', error, {
      feature: 'practitioners',
      extra: { practitionerId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to complete practitioner profile setup'
      )
    );
  }
};

export const completePractitionerProfileSetup = (
  db: DbConnection,
  input: CompletePractitionerProfileSetupInput
) =>
  trackedResult(
    'practitioners.completePractitionerProfileSetup',
    () =>
      withOrgScope((tx) => completePractitionerProfileSetupImpl(tx, input), {
        db,
      }),
    {
      properties: {
        practitionerId: input.practitionerId,
        organizationId: input.organizationId,
      },
    }
  );

export type CompletePractitionerProfileSetupResult = Awaited<
  ReturnType<typeof completePractitionerProfileSetup>
>;
