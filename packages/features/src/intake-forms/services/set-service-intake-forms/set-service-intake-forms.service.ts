import { form, formServiceRequirement } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type SetServiceIntakeFormsInput,
  setServiceIntakeFormsSchema,
} from './set-service-intake-forms.schema.js';

// Replace-the-set, not incremental: the editor sends the full desired list, so
// we clear this service's links and re-insert. Simpler than diffing and the set
// is tiny.
//
// `blocksBooking` arrives on the wire and is ACCEPTED but not stored:
// `form_service_requirement` has no such column and a row on it already means
// "required". See the note in get-service-intake-forms.service.ts. Every form
// the editor sends is linked, whatever the flag said — dropping the unticked
// ones would lose the link entirely, which is the worse of the two losses.
const setServiceIntakeFormsImpl = async (
  db: DbConnection,
  input: SetServiceIntakeFormsInput
): Promise<Result<{ serviceId: string; count: number }>> => {
  const parsed = setServiceIntakeFormsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationId, serviceId, forms } = parsed.data;
  try {
    await db.delete(formServiceRequirement).where(
      and(
        eq(formServiceRequirement.organizationId, organizationId),
        eq(formServiceRequirement.serviceId, serviceId),
        // `form_service_requirement` is shared with consent (and later notes).
        // Replace-the-set must replace THIS service's INTAKE links only — an
        // unqualified delete here would silently unlink its consent forms too.
        inArray(
          formServiceRequirement.formId,
          db
            .select({ id: form.id })
            .from(form)
            .where(
              and(
                eq(form.organizationId, organizationId),
                eq(form.kind, 'intake')
              )
            )
        )
      )
    );
    if (forms.length > 0) {
      await db.insert(formServiceRequirement).values(
        forms.map((f) => ({
          organizationId,
          serviceId,
          formId: f.intakeFormId,
        }))
      );
    }
    return ok({ serviceId, count: forms.length });
  } catch (error) {
    logError('intakeForms.setServiceIntakeForms', error, {
      feature: 'intake-forms',
      extra: { serviceId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to link forms')
    );
  }
};

export const setServiceIntakeForms = (
  db: DbConnection,
  input: SetServiceIntakeFormsInput
) =>
  trackedResult(
    'intakeForms.setServiceIntakeForms',
    () => setServiceIntakeFormsImpl(db, input),
    {
      properties: { serviceId: input.serviceId },
    }
  );
export type SetServiceIntakeFormsResult = Awaited<
  ReturnType<typeof setServiceIntakeForms>
>;
