import { form, isUniqueViolation } from '@borradh-workspace/database';
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
  type IntakeFormRow,
  toIntakeFormRow,
} from '../../shared/wire-shape.js';
import {
  type UpdateIntakeFormInput,
  updateIntakeFormSchema,
} from './update-intake-form.schema.js';

const updateIntakeFormImpl = async (
  db: DbConnection,
  input: UpdateIntakeFormInput
): Promise<Result<IntakeFormRow>> => {
  const parsed = updateIntakeFormSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationId, id, ...rest } = parsed.data;
  const patch = Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined)
  );
  if (Object.keys(patch).length === 0) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Nothing to update')
    );
  }
  try {
    const [result] = await db
      .update(form)
      .set(patch)
      .where(
        and(
          eq(form.id, id),
          eq(form.organizationId, organizationId),
          eq(form.kind, 'intake'),
          notDeleted(form)
        )
      )
      .returning();
    if (!result)
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Form not found'));
    return ok(toIntakeFormRow(result));
  } catch (error) {
    // The database decides — see create-intake-form for why the pre-check
    // was dropped. drizzle wraps the postgres.js error, so the constraint
    // lives on the `.cause` chain, not `error.message`.
    if (isUniqueViolation(error, 'uq_form_org_kind_name')) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'A form with this name already exists'
        )
      );
    }
    logError('intakeForms.updateIntakeForm', error, {
      feature: 'intake-forms',
      extra: { id },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to update form')
    );
  }
};

export const updateIntakeForm = (
  db: DbConnection,
  input: UpdateIntakeFormInput
) =>
  trackedResult(
    'intakeForms.updateIntakeForm',
    () => updateIntakeFormImpl(db, input),
    {
      properties: { id: input.id },
    }
  );
export type UpdateIntakeFormResult = Awaited<
  ReturnType<typeof updateIntakeForm>
>;
