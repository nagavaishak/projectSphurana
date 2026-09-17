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
  type UpdateServiceVariantInput,
  updateServiceVariantSchema,
} from './update-service-variant.schema.js';

const updateServiceVariantImpl = async (
  db: DbConnection,
  input: UpdateServiceVariantInput
): Promise<Result<typeof organizationServiceVariant.$inferSelect>> => {
  const parsed = updateServiceVariantSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, ...updates } = parsed.data;

  // Org-scope guard: load the variant with just its parent service's org id and
  // confirm it matches. A mismatched (or missing) parent is NOT_FOUND — never
  // leak that a variant exists under another org.
  const existing = await db.query.organizationServiceVariant.findFirst({
    where: eq(organizationServiceVariant.id, id),
    with: { service: { columns: { organizationId: true } } },
  });

  if (!existing || existing.service.organizationId !== organizationId) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Variant not found', { id })
    );
  }

  const updateData: Partial<typeof organizationServiceVariant.$inferInsert> =
    {};
  if (updates.name !== undefined) updateData.name = updates.name;
  if (updates.priceCents !== undefined)
    updateData.priceCents = updates.priceCents;
  if (updates.durationMinutes !== undefined)
    updateData.durationMinutes = updates.durationMinutes;
  if (updates.sortOrder !== undefined) updateData.sortOrder = updates.sortOrder;
  if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

  const [result] = await db
    .update(organizationServiceVariant)
    .set(updateData)
    .where(eq(organizationServiceVariant.id, id))
    .returning();

  return ok(result);
};

export const updateServiceVariant = (
  db: DbConnection,
  input: UpdateServiceVariantInput
) =>
  trackedResult(
    'organizationServices.updateServiceVariant',
    () => withOrgScope((tx) => updateServiceVariantImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );

export type UpdateServiceVariantResult = Awaited<
  ReturnType<typeof updateServiceVariant>
>;
