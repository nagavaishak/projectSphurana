import { resource, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  atLocationOrUnscoped,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type ReorderResourcesInput,
  reorderResourcesSchema,
} from './reorder-resources.schema.js';

/**
 * Drag-to-reorder writes the whole visible order in one transaction, so a
 * partial write can never leave the list in an order nobody chose. Every id is
 * checked against the org — and, when the caller names a branch, against that
 * branch — before anything is written. A foreign id fails the batch rather
 * than silently no-op'ing one row.
 *
 * The branch check uses `atLocationOrUnscoped`, so a location-less resource
 * stays reorderable from every branch. A bare equality would refuse the whole
 * batch the moment a trolley appeared in the list the user just dragged —
 * which is every list that has one.
 */
const reorderResourcesImpl = async (
  db: DbConnection,
  input: ReorderResourcesInput
): Promise<Result<{ success: true }>> => {
  const parsed = reorderResourcesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, locationId, items } = parsed.data;
  const ids = items.map((item) => item.id);

  try {
    const owned = await db.query.resource.findMany({
      where: and(
        eq(resource.organizationId, organizationId),
        inArray(resource.id, ids),
        notDeleted(resource),
        locationId
          ? atLocationOrUnscoped(resource.locationId, locationId)
          : undefined
      ),
      columns: { id: true },
    });

    if (owned.length !== ids.length) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          locationId
            ? 'One or more resources do not belong to this organization or branch'
            : 'One or more resources do not belong to this organization'
        )
      );
    }

    await db.transaction(async (tx) => {
      for (const item of items) {
        await tx
          .update(resource)
          .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
          .where(
            and(
              eq(resource.id, item.id),
              eq(resource.organizationId, organizationId)
            )
          );
      }
    });

    return ok({ success: true as const });
  } catch (error) {
    logError('resources.reorderResources', error, {
      feature: 'resources',
      extra: { organizationId, count: items.length },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to reorder resources')
    );
  }
};

export const reorderResources = (
  db: DbConnection,
  input: ReorderResourcesInput
) =>
  trackedResult(
    'resources.reorderResources',
    () => withOrgScope((tx) => reorderResourcesImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        count: input.items?.length,
      },
    }
  );

export type ReorderResourcesResult = Awaited<
  ReturnType<typeof reorderResources>
>;
