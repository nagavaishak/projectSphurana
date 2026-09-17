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
import type { ResourceCategoryWithCount } from '../../models/index.js';
import {
  type ListResourceCategoriesInput,
  listResourceCategoriesSchema,
} from './list-resource-categories.schema.js';

/**
 * Categories with the number of resources in each.
 *
 * TWO COUNTS, because two callers ask different questions and one number
 * cannot answer both:
 *
 *  · `resourceCount` is scoped to the BRANCH when one is given. Its real
 *    consumer is `useResourceScheduling`, which decides whether the
 *    appointment panel offers a room picker for a category. Org-wide, a Cork
 *    booking was offered a "Lasers" picker that could only ever be empty,
 *    because every laser is at Dublin.
 *
 *  · `resourceCountAllBranches` is the org-wide number, and it is the one
 *    `deleteResourceCategory` enforces — that guard counts every resource in
 *    the category regardless of branch, because deleting a category deletes it
 *    for the whole org.
 *
 * Shipping only the branch-scoped number is the trap: Cork would read
 * "Lasers: 0", the operator would press delete, and the server would refuse
 * with "Delete or move the 3 resources in this category first" — counting
 * Dublin's. Carrying both lets the caller say so instead of contradicting
 * itself.
 *
 * A resource with NO branch is counted at every branch: it is available at all
 * of them, so a picker must be offered wherever it could be used.
 *
 * Both counts include DEACTIVATED resources (they still live in the category
 * and still block its deletion); neither includes soft-deleted ones.
 */
const listResourceCategoriesImpl = async (
  db: DbConnection,
  input: ListResourceCategoriesInput
): Promise<Result<ResourceCategoryWithCount[]>> => {
  const parsed = listResourceCategoriesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, includeInactive, locationId } = parsed.data;

  try {
    const categories = await db.query.resourceCategory.findMany({
      where: and(
        eq(resourceCategory.organizationId, organizationId),
        notDeleted(resourceCategory),
        includeInactive ? undefined : eq(resourceCategory.isActive, true)
      ),
    });

    // Fetched org-wide and partitioned in memory: both counts come from one
    // query, and the branch predicate is a comparison rather than a second
    // round trip.
    const resources = await db.query.resource.findMany({
      where: and(
        eq(resource.organizationId, organizationId),
        notDeleted(resource)
      ),
      columns: { id: true, categoryId: true, locationId: true },
    });

    const counts = new Map<string, number>();
    const allBranchCounts = new Map<string, number>();
    for (const row of resources) {
      allBranchCounts.set(
        row.categoryId,
        (allBranchCounts.get(row.categoryId) ?? 0) + 1
      );
      // No branch asked for → every resource counts. A resource with no branch
      // of its own counts everywhere.
      const atThisBranch =
        !locationId || row.locationId === null || row.locationId === locationId;
      if (atThisBranch) {
        counts.set(row.categoryId, (counts.get(row.categoryId) ?? 0) + 1);
      }
    }

    const withCounts = categories.map((category) => ({
      ...category,
      resourceCount: counts.get(category.id) ?? 0,
      resourceCountAllBranches: allBranchCounts.get(category.id) ?? 0,
    }));

    withCounts.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
    );

    return ok(withCounts);
  } catch (error) {
    logError('resources.listResourceCategories', error, {
      feature: 'resources',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to list resource categories'
      )
    );
  }
};

export const listResourceCategories = (
  db: DbConnection,
  input: ListResourceCategoriesInput
) =>
  trackedResult(
    'resources.listResourceCategories',
    () => withOrgScope((tx) => listResourceCategoriesImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type ListResourceCategoriesResult = Awaited<
  ReturnType<typeof listResourceCategories>
>;
