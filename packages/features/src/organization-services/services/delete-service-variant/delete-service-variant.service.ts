import {
  organizationServiceVariant,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type DeleteServiceVariantInput,
  deleteServiceVariantSchema,
} from './delete-service-variant.schema.js';

const deleteServiceVariantImpl = async (
  db: DbConnection,
  input: DeleteServiceVariantInput
): Promise<Result<{ id: string }>> => {
  const parsed = deleteServiceVariantSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId } = parsed.data;

  // Org-scope guard via the parent service's org id.
  const existing = await db.query.organizationServiceVariant.findFirst({
    where: eq(organizationServiceVariant.id, id),
    with: { service: { columns: { organizationId: true } } },
  });

  if (!existing || existing.service.organizationId !== organizationId) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Variant not found', { id })
    );
  }

  await db
    .delete(organizationServiceVariant)
    .where(eq(organizationServiceVariant.id, id));

  return ok({ id });
};

export const deleteServiceVariant = (
  db: DbConnection,
  input: DeleteServiceVariantInput
) =>
  trackedResult(
    'organizationServices.deleteServiceVariant',
    () => withOrgScope((tx) => deleteServiceVariantImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );

export type DeleteServiceVariantResult = Awaited<
  ReturnType<typeof deleteServiceVariant>
>;
