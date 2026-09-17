import {
  resource,
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
import { pluralize } from '../_shared/index.js';
import {
  type DeleteResourceCategoryInput,
  deleteResourceCategorySchema,
} from './delete-resource-category.schema.js';

/**
 * SOFT delete — the partial unique index frees the name for reuse, and any
 * historical requirement rows keep resolving.
 *
 * Blocked while the category still holds resources: emptying it is a decision
 * the clinic has to make explicitly (move the rooms elsewhere or delete them),
 * never a silent cascade.
 */
const deleteResourceCategoryImpl = async (
  db: DbConnection,
  input: DeleteResourceCategoryInput
): Promise<Result<{ id: string }>> => {
  const parsed = deleteResourceCategorySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, locationId } = parsed.data;

  try {
    const existing = await db.query.resourceCategory.findFirst({
      where: and(
        eq(resourceCategory.id, id),
        eq(resourceCategory.organizationId, organizationId),
        notDeleted(resourceCategory)
      ),
      columns: { id: true },
    });

    if (!existing) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Resource category not found')
      );
    }

    const remaining = await db.query.resource.findMany({
      where: and(
        eq(resource.categoryId, id),
        eq(resource.organizationId, organizationId),
        notDeleted(resource)
      ),
      columns: { id: true, locationId: true },
    });

    // How many of them the operator CANNOT see from where they are standing.
    // Zero on a single-branch org, and zero when they are all here — the
    // sentence only appears when it explains something.
    const elsewhere = locationId
      ? remaining.filter(
          (row) => row.locationId !== null && row.locationId !== locationId
        ).length
      : 0;

    if (remaining.length > 0) {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          // A CATEGORY IS ORG-WIDE, its resources are not. The settings list
          // counts what is at the branch you are looking at, so an operator
          // standing at Cork can read "Lasers: 0", press delete, and be told
          // "move the 3 resources first" — counting Dublin's, and reading as a
          // bug. The message names the mismatch instead.
          //
          // Only when the resources really are elsewhere: on a single-branch
          // org, or when they are all here, the sentence would be noise.
          `Delete or move the ${remaining.length} ${pluralize(
            remaining.length,
            'resource'
          )} in this category first${
            elsewhere > 0
              ? ` (${elsewhere} at ${
                  elsewhere === 1 ? 'another branch' : 'other branches'
                } — a category is shared across all of them)`
              : ''
          }`,
          { resourceCount: remaining.length }
        )
      );
    }

    await db
      .update(resourceCategory)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(resourceCategory.id, id),
          eq(resourceCategory.organizationId, organizationId)
        )
      );

    return ok({ id });
  } catch (error) {
    logError('resources.deleteResourceCategory', error, {
      feature: 'resources',
      extra: { id, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to delete resource category'
      )
    );
  }
};

export const deleteResourceCategory = (
  db: DbConnection,
  input: DeleteResourceCategoryInput
) =>
  trackedResult(
    'resources.deleteResourceCategory',
    () => withOrgScope((tx) => deleteResourceCategoryImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );

export type DeleteResourceCategoryResult = Awaited<
  ReturnType<typeof deleteResourceCategory>
>;
