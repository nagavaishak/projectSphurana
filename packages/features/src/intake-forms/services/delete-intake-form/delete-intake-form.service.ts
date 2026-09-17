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
  type DeleteIntakeFormInput,
  deleteIntakeFormSchema,
} from './delete-intake-form.schema.js';

const deleteIntakeFormImpl = async (
  db: DbConnection,
  input: DeleteIntakeFormInput
): Promise<Result<{ id: string }>> => {
  const parsed = deleteIntakeFormSchema.safeParse(input);
  if (!parsed.success) {
    return err(new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input'));
  }
  // Soft delete: submissions made against this form must stay readable on client
  // files (a signed consent does not vanish because the template was retired).
  const [result] = await db
    .update(form)
    .set({ deletedAt: new Date(), isActive: false })
    .where(
      and(
        eq(form.id, parsed.data.id),
        eq(form.organizationId, parsed.data.organizationId),
        eq(form.kind, 'intake'),
        notDeleted(form)
      )
    )
    .returning({ id: form.id });
  if (!result)
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Form not found'));
  return ok(result);
};

export const deleteIntakeForm = (
  db: DbConnection,
  input: DeleteIntakeFormInput
) =>
  trackedResult(
    'intakeForms.deleteIntakeForm',
    () => deleteIntakeFormImpl(db, input),
    {
      properties: { id: input.id },
      internalErrorsOnly: true,
    }
  );
export type DeleteIntakeFormResult = Awaited<
  ReturnType<typeof deleteIntakeForm>
>;
