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
import {
  MAX_RESOURCE_CATEGORIES,
  isCategoryNameConflict,
} from '../_shared/index.js';
import {
  type CreateResourceCategoryInput,
  createResourceCategorySchema,
} from './create-resource-category.schema.js';

const createResourceCategoryImpl = async (
  db: DbConnection,
  input: CreateResourceCategoryInput
): Promise<Result<ResourceCategory>> => {
  const parsed = createResourceCategorySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    // Cap enforced here rather than at the schema, because it depends on what
    // the org already has. Counts live (non-deleted) categories only, so
    // deleting one frees a slot.
    const existing = await db
      .select({ id: resourceCategory.id })
      .from(resourceCategory)
      .where(
        and(
          eq(resourceCategory.organizationId, parsed.data.organizationId),
          notDeleted(resourceCategory)
        )
      );

    if (existing.length >= MAX_RESOURCE_CATEGORIES) {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          `You can have up to ${MAX_RESOURCE_CATEGORIES} categories. Delete one to add another.`,
          { limit: MAX_RESOURCE_CATEGORIES, current: existing.length }
        )
      );
    }

    const [result] = await db
      .insert(resourceCategory)
      .values(parsed.data)
      .returning();

    return ok(result);
  } catch (error) {
    // Partial unique index (organization_id, name) WHERE deleted_at IS NULL.
    if (isCategoryNameConflict(error)) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'A resource category with this name already exists'
        )
      );
    }
    logError('resources.createResourceCategory', error, {
      feature: 'resources',
      extra: { organizationId: parsed.data.organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create resource category'
      )
    );
  }
};

export const createResourceCategory = (
  db: DbConnection,
  input: CreateResourceCategoryInput
) =>
  trackedResult(
    'resources.createResourceCategory',
    () => withOrgScope((tx) => createResourceCategoryImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId, kind: input.kind },
    }
  );

export type CreateResourceCategoryResult = Awaited<
  ReturnType<typeof createResourceCategory>
>;
