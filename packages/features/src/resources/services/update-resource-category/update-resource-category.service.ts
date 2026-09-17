import {
  type ResourceCategory,
  resourceCategory,
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
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { isCategoryNameConflict } from '../_shared/index.js';
import {
  type UpdateResourceCategoryInput,
  updateResourceCategorySchema,
} from './update-resource-category.schema.js';

const updateResourceCategoryImpl = async (
  db: DbConnection,
  input: UpdateResourceCategoryInput
): Promise<Result<ResourceCategory>> => {
  const parsed = updateResourceCategorySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, ...updates } = parsed.data;

  const patch = Object.fromEntries(
    Object.entries(updates).filter(([, value]) => value !== undefined)
  );

  try {
    const [result] = await db
      .update(resourceCategory)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(resourceCategory.id, id),
          eq(resourceCategory.organizationId, organizationId),
          notDeleted(resourceCategory)
        )
      )
      .returning();

    if (!result) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Resource category not found')
      );
    }

    return ok(result);
  } catch (error) {
    if (isCategoryNameConflict(error)) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'A resource category with this name already exists'
        )
      );
    }
    logError('resources.updateResourceCategory', error, {
      feature: 'resources',
      extra: { id, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update resource category'
      )
    );
  }
};

export const updateResourceCategory = (
  db: DbConnection,
  input: UpdateResourceCategoryInput
) =>
  trackedResult(
    'resources.updateResourceCategory',
    () => withOrgScope((tx) => updateResourceCategoryImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );

export type UpdateResourceCategoryResult = Awaited<
  ReturnType<typeof updateResourceCategory>
>;
