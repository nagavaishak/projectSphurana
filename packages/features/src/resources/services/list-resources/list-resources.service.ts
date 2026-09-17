import { resource, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
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
import type { ResourceWithCategory } from '../../models/index.js';
import {
  type ListResourcesInput,
  listResourcesSchema,
} from './list-resources.schema.js';

/**
 * Every resource joined with its category, ordered the way the settings screen
 * and the rooms calendar render it: category order, then resource order, then
 * name. Sorting here (not in SQL) keeps the category's own `sortOrder` out of
 * the returned shape while still driving the grouping.
 */
const listResourcesImpl = async (
  db: DbConnection,
  input: ListResourcesInput
): Promise<Result<ResourceWithCategory[]>> => {
  const parsed = listResourcesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, categoryId, locationId, includeInactive } =
    parsed.data;

  try {
    const rows = await db.query.resource.findMany({
      where: and(
        eq(resource.organizationId, organizationId),
        notDeleted(resource),
        includeInactive ? undefined : eq(resource.isActive, true),
        categoryId ? eq(resource.categoryId, categoryId) : undefined,
        // A location-less resource is available everywhere, so it belongs in
        // every branch's list. A bare `eq()` here hid exactly those rows.
        locationId
          ? atLocationOrUnscoped(resource.locationId, locationId)
          : undefined
      ),
      with: {
        category: {
          columns: { id: true, name: true, kind: true, sortOrder: true },
        },
      },
    });

    const sorted = [...rows].sort(
      (a, b) =>
        (a.category?.sortOrder ?? 0) - (b.category?.sortOrder ?? 0) ||
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name)
    );

    const withCategory = sorted.map(({ category, ...row }) => ({
      ...row,
      category: {
        id: category.id,
        name: category.name,
        kind: category.kind,
      },
    }));

    return ok(withCategory);
  } catch (error) {
    logError('resources.listResources', error, {
      feature: 'resources',
      extra: { organizationId, categoryId, locationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to list resources')
    );
  }
};

export const listResources = (db: DbConnection, input: ListResourcesInput) =>
  trackedResult(
    'resources.listResources',
    () => withOrgScope((tx) => listResourcesImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type ListResourcesResult = Awaited<ReturnType<typeof listResources>>;
