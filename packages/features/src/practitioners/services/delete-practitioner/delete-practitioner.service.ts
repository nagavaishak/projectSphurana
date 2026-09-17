import { practitioner, withOrgScope } from '@borradh-workspace/database';
import {
  isFeatureOn,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  logAuditEvent,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type DeletePractitionerInput,
  deletePractitionerSchema,
} from './delete-practitioner.schema.js';

const deletePractitionerImpl = async (
  db: DbConnection,
  input: DeletePractitionerInput
): Promise<Result<{ success: true }>> => {
  const parsed = deletePractitionerSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    if (!(await isFeatureOn('killswitch-soft-deletes'))) {
      await db
        .delete(practitioner)
        .where(
          and(
            eq(practitioner.id, parsed.data.id),
            eq(practitioner.organizationId, parsed.data.organizationId)
          )
        );
      return ok({ success: true as const });
    }

    const [result] = await db
      .update(practitioner)
      .set({ deletedAt: new Date(), isActive: false })
      .where(
        and(
          eq(practitioner.id, parsed.data.id),
          eq(practitioner.organizationId, parsed.data.organizationId),
          notDeleted(practitioner)
        )
      )
      .returning();

    if (!result) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Practitioner not found')
      );
    }

    return ok({ success: true as const });
  } catch (error) {
    logError('practitioners.deletePractitioner', error, {
      feature: 'practitioners',
      extra: { id: parsed.data.id },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to delete practitioner'
      )
    );
  }
};

export const deletePractitioner = async (
  db: DbConnection,
  input: DeletePractitionerInput
) => {
  const result = await trackedResult(
    'practitioners.deletePractitioner',
    () => withOrgScope((tx) => deletePractitionerImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );
  // Audit log fires after transaction commits — safe from phantom entries on rollback
  if (result.success) {
    logAuditEvent(db, {
      action: 'delete',
      entityType: 'practitioner',
      entityId: input.id,
      actorType: 'user',
      actorId: input.actorId ?? null,
      organizationId: input.organizationId,
    }).catch((error) => {
      logError('practitioners.deletePractitioner.auditLog', error, {
        feature: 'practitioners',
        extra: { id: input.id, organizationId: input.organizationId },
      });
    });
  }
  return result;
};

export type DeletePractitionerResult = Awaited<
  ReturnType<typeof deletePractitioner>
>;
