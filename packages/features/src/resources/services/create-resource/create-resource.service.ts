import {
  type Resource,
  organizationLocation,
  resource,
  resourceCategory,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, sql } from 'drizzle-orm';
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
  type CreateResourceInput,
  createResourceSchema,
} from './create-resource.schema.js';

const createResourceImpl = async (
  db: DbConnection,
  input: CreateResourceInput
): Promise<Result<Resource>> => {
  const parsed = createResourceSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, categoryId, locationId } = parsed.data;

  try {
    // The category FK cascades, so a foreign category id would otherwise be a
    // 500 from Postgres rather than a fixable message.
    const category = await db.query.resourceCategory.findFirst({
      where: and(
        eq(resourceCategory.id, categoryId),
        eq(resourceCategory.organizationId, organizationId),
        notDeleted(resourceCategory)
      ),
      columns: { id: true },
    });

    if (!category) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Resource category not found')
      );
    }

    if (locationId) {
      const location = await db.query.organizationLocation.findFirst({
        where: and(
          eq(organizationLocation.id, locationId),
          eq(organizationLocation.organizationId, organizationId)
        ),
        columns: { id: true },
      });

      if (!location) {
        return err(
          new FeatureError(ErrorCodes.NOT_FOUND, 'Location not found')
        );
      }
    }

    // Append, don't pile up at 0. `sortOrder` is the clinic's own order and it
    // is the FIRST tie-break the allocator uses when several rooms are free
    // (see filter-slots-by-resources). Defaulting every row to 0 pushed that
    // decision onto the id, so a two-room clinic got its rooms picked in cuid
    // order — "why does it always start with Room 2?".
    const nextSortOrder =
      parsed.data.sortOrder ??
      (
        await db
          .select({
            next: sql<number>`coalesce(max(${resource.sortOrder}), -1) + 1`,
          })
          .from(resource)
          .where(
            and(
              eq(resource.organizationId, organizationId),
              eq(resource.categoryId, categoryId),
              notDeleted(resource)
            )
          )
      )[0]?.next ??
      0;

    const [result] = await db
      .insert(resource)
      .values({ ...parsed.data, sortOrder: nextSortOrder })
      .returning();

    return ok(result);
  } catch (error) {
    logError('resources.createResource', error, {
      feature: 'resources',
      extra: { organizationId, categoryId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to create resource')
    );
  }
};

export const createResource = (db: DbConnection, input: CreateResourceInput) =>
  trackedResult(
    'resources.createResource',
    () => withOrgScope((tx) => createResourceImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        categoryId: input.categoryId,
      },
    }
  );

export type CreateResourceResult = Awaited<ReturnType<typeof createResource>>;
