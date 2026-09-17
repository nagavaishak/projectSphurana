import { form } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
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
  type GetIntakeFormInput,
  getIntakeFormSchema,
} from './get-intake-form.schema.js';

const getIntakeFormImpl = async (
  db: DbConnection,
  input: GetIntakeFormInput
): Promise<Result<IntakeFormRow>> => {
  const parsed = getIntakeFormSchema.safeParse(input);
  if (!parsed.success) {
    return err(new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input'));
  }
  const result = await db.query.form.findFirst({
    where: and(
      eq(form.id, parsed.data.id),
      eq(form.organizationId, parsed.data.organizationId),
      // Never resolve a consent document or a clinical note through the intake
      // surface — the unified table holds all three.
      eq(form.kind, 'intake'),
      notDeleted(form)
    ),
  });
  if (!result)
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Form not found'));
  return ok(toIntakeFormRow(result));
};

export const getIntakeForm = (db: DbConnection, input: GetIntakeFormInput) =>
  trackedResult(
    'intakeForms.getIntakeForm',
    () => getIntakeFormImpl(db, input),
    {
      properties: { id: input.id },
      internalErrorsOnly: true,
    }
  );
export type GetIntakeFormResult = Awaited<ReturnType<typeof getIntakeForm>>;
