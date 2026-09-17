import {
  organizationService,
  organizationServiceCategory,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type DeleteCategoryInput,
  deleteCategorySchema,
} from './delete-category.schema.js';

/**
 * Delete a category. Hard-blocks if any service still references this
 * category (the schema FK is `restrict`). Caller must reassign affected
 * services to another category before deleting.
 */
const deleteCategoryImpl = async (
  db: DbConnection,
  input: DeleteCategoryInput
): Promise<Result<{ success: true }>> => {
  const parsed = deleteCategorySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId } = parsed.data;

  const existing = await db.query.organizationServiceCategory.findFirst({
    where: and(
      eq(organizationServiceCategory.id, id),
      eq(organizationServiceCategory.organizationId, organizationId)
    ),
  });

  if (!existing) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Category not found'));
  }

  const referencingService = await db.query.organizationService.findFirst({
    where: eq(organizationService.categoryId, id),
    columns: { id: true },
  });

  if (referencingService) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'Cannot delete category: services are still assigned to it. Move them to another category first.'
      )
    );
  }

  try {
    await db
      .delete(organizationServiceCategory)
      .where(eq(organizationServiceCategory.id, id));
    return ok({ success: true as const });
  } catch (error) {
    logError('serviceCategories.deleteCategory', error, {
      feature: 'service-categories',
      extra: { id, organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to delete category')
    );
  }
};

export const deleteCategory = (db: DbConnection, input: DeleteCategoryInput) =>
  trackedResult(
    'serviceCategories.deleteCategory',
    () => withOrgScope((tx) => deleteCategoryImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );

export type DeleteCategoryResult = Awaited<ReturnType<typeof deleteCategory>>;
