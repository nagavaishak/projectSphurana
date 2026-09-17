import { form, isUniqueViolation } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type IntakeFormRow,
  toIntakeFormRow,
} from '../../shared/wire-shape.js';
import {
  type CreateIntakeFormInput,
  createIntakeFormSchema,
} from './create-intake-form.schema.js';

const createIntakeFormImpl = async (
  db: DbConnection,
  input: CreateIntakeFormInput
): Promise<Result<IntakeFormRow>> => {
  const parsed = createIntakeFormSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const [result] = await db
      .insert(form)
      .values({
        organizationId: parsed.data.organizationId,
        kind: 'intake',
        name: parsed.data.name,
        description: parsed.data.description,
        fields: parsed.data.fields,
        createdById: parsed.data.createdById,
      })
      .returning();
    return ok(toIntakeFormRow(result));
  } catch (error) {
    /**
     * The database decides, not a pre-check.
     *
     * `uq_intake_form_org_name` did not survive the merge into `form`, and an
     * earlier pass replaced it with a `SELECT` before the insert — which two
     * simultaneous creates of the same name both pass. ENG-844 (#975) had just
     * fixed this very 409 to actually fire, which is the proof it is relied on,
     * so the constraint is restored as `uq_form_org_kind_name` (scoped by kind,
     * partial on not-deleted) and detected the same way.
     *
     * drizzle wraps the postgres.js error — the constraint lives on the
     * `.cause` chain, not `error.message` (see isUniqueViolation).
     */
    if (isUniqueViolation(error, 'uq_form_org_kind_name')) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'A form with this name already exists'
        )
      );
    }

    logError('intakeForms.createIntakeForm', error, {
      feature: 'intake-forms',
      extra: { organizationId: parsed.data.organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to create form')
    );
  }
};

export const createIntakeForm = (
  db: DbConnection,
  input: CreateIntakeFormInput
) =>
  trackedResult(
    'intakeForms.createIntakeForm',
    () => createIntakeFormImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type CreateIntakeFormResult = Awaited<
  ReturnType<typeof createIntakeForm>
>;
