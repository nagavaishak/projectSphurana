import {
  organizationServiceCategory,
  withOrgScope,
} from '@borradh-workspace/database';
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
  type UpdateCategoryInput,
  updateCategorySchema,
} from './update-category.schema.js';

const updateCategoryImpl = async (
  db: DbConnection,
  input: UpdateCategoryInput
): Promise<Result<typeof organizationServiceCategory.$inferSelect>> => {
  const parsed = updateCategorySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, ...updates } = parsed.data;

  const existing = await db.query.organizationServiceCategory.findFirst({
    where: and(
      eq(organizationServiceCategory.id, id),
      eq(organizationServiceCategory.organizationId, organizationId)
    ),
  });

  if (!existing) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Category not found'));
  }

  // Duplicate name check (only if name being changed)
  if (updates.name && updates.name !== existing.name) {
    const dupe = await db.query.organizationServiceCategory.findFirst({
      where: and(
        eq(organizationServiceCategory.organizationId, organizationId),
        eq(organizationServiceCategory.name, updates.name),
        ne(organizationServiceCategory.id, id)
      ),
    });
    if (dupe) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          `Category "${updates.name}" already exists`
        )
      );
    }
  }

  const [updated] = await db
    .update(organizationServiceCategory)
    .set({
      ...(updates.name !== undefined && { name: updates.name }),
      ...(updates.description !== undefined && {
        description: updates.description,
      }),
      ...(updates.sortOrder !== undefined && { sortOrder: updates.sortOrder }),
      ...(updates.isActive !== undefined && { isActive: updates.isActive }),
    })
    .where(eq(organizationServiceCategory.id, id))
    .returning();

  return ok(updated);
};

export const updateCategory = (db: DbConnection, input: UpdateCategoryInput) =>
  trackedResult(
    'serviceCategories.updateCategory',
    () => withOrgScope((tx) => updateCategoryImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );

export type UpdateCategoryResult = Awaited<ReturnType<typeof updateCategory>>;
