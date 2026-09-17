import {
  isUniqueViolation,
  practitioner,
  withOrgScope,
} from '@borradh-workspace/database';
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
  type UpdatePractitionerInput,
  updatePractitionerSchema,
} from './update-practitioner.schema.js';

const updatePractitionerImpl = async (
  db: DbConnection,
  input: UpdatePractitionerInput
): Promise<Result<Practitioner>> => {
  const parsed = updatePractitionerSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, ...data } = parsed.data;

  // Remove undefined values so we only update provided fields
  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      updates[key] = value;
    }
  }

  // Keep the derived display name in sync: when the caller renames via
  // first/last but doesn't send an explicit `name`, recompute it.
  if (
    updates.name === undefined &&
    typeof data.firstName === 'string' &&
    typeof data.lastName === 'string'
  ) {
    const derived = `${data.firstName} ${data.lastName}`.trim();
    if (derived) {
      updates.name = derived;
    }
  }

  if (Object.keys(updates).length === 0) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'No fields to update')
    );
  }

  try {
    const [result] = await db
      .update(practitioner)
      .set(updates)
      .where(
        and(
          eq(practitioner.id, id),
          eq(practitioner.organizationId, organizationId),
          notDeleted(practitioner)
        )
      )
      .returning();

    if (!result) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Practitioner not found')
      );
    }

    return ok(result);
  } catch (error) {
    // Same drizzle wrapping as createPractitioner: the constraint name is on
    // the `cause` chain, not on the wrapper's message. See ENG-721.
    if (isUniqueViolation(error, 'practitioner_org_email_unique')) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'A practitioner with this email already exists in this organization'
        )
      );
    }

    logError('practitioners.updatePractitioner', error, {
      feature: 'practitioners',
      extra: { id, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update practitioner'
      )
    );
  }
};

export const updatePractitioner = (
  db: DbConnection,
  input: UpdatePractitionerInput
) =>
  trackedResult(
    'practitioners.updatePractitioner',
    () => withOrgScope((tx) => updatePractitionerImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );

export type UpdatePractitionerResult = Awaited<
  ReturnType<typeof updatePractitioner>
>;
