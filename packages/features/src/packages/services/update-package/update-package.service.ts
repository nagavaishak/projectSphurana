import { organizationPackage, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq, ne } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type UpdatePackageInput,
  updatePackageSchema,
} from './update-package.schema.js';

const updatePackageImpl = async (
  db: DbConnection,
  input: UpdatePackageInput
): Promise<Result<typeof organizationPackage.$inferSelect>> => {
  const parsed = updatePackageSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, ...updates } = parsed.data;

  const existing = await db.query.organizationPackage.findFirst({
    where: and(
      eq(organizationPackage.id, id),
      eq(organizationPackage.organizationId, organizationId)
    ),
  });
  if (!existing) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Package not found'));
  }

  if (updates.name && updates.name !== existing.name) {
    const dupe = await db.query.organizationPackage.findFirst({
      where: and(
        eq(organizationPackage.organizationId, organizationId),
        eq(organizationPackage.name, updates.name),
        ne(organizationPackage.id, id)
      ),
    });
    if (dupe) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          `Package "${updates.name}" already exists`
        )
      );
    }
  }

  const { categoryId } = updates;
  if (categoryId) {
    const category = await db.query.organizationServiceCategory.findFirst({
      where: (cat, { eq: e, and: a }) =>
        a(e(cat.id, categoryId), e(cat.organizationId, organizationId)),
      columns: { id: true },
    });
    if (!category) {
      return err(
        new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Category not found')
      );
    }
  }

  const [updated] = await db
    .update(organizationPackage)
    .set({
      ...(updates.name !== undefined && { name: updates.name }),
      ...(updates.description !== undefined && {
        description: updates.description,
      }),
      ...(updates.categoryId !== undefined && {
        categoryId: updates.categoryId,
      }),
      ...(updates.priceCents !== undefined && {
        priceCents: updates.priceCents,
      }),
      ...(updates.validityDays !== undefined && {
        validityDays: updates.validityDays,
      }),
      ...(updates.requiresDeposit !== undefined && {
        requiresDeposit: updates.requiresDeposit,
      }),
      ...(updates.depositAmountCents !== undefined && {
        depositAmountCents: updates.depositAmountCents,
      }),
      ...(updates.sortOrder !== undefined && { sortOrder: updates.sortOrder }),
      ...(updates.isActive !== undefined && { isActive: updates.isActive }),
    })
    .where(eq(organizationPackage.id, id))
    .returning();

  return ok(updated);
};

export const updatePackage = (db: DbConnection, input: UpdatePackageInput) =>
  trackedResult(
    'packages.updatePackage',
    () => withOrgScope((tx) => updatePackageImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );

export type UpdatePackageResult = Awaited<ReturnType<typeof updatePackage>>;
