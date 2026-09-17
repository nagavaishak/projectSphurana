import {
  type Resource,
  organizationLocation,
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
import {
  type UpdateResourceInput,
  updateResourceSchema,
} from './update-resource.schema.js';

const updateResourceImpl = async (
  db: DbConnection,
  input: UpdateResourceInput
): Promise<Result<Resource>> => {
  const parsed = updateResourceSchema.safeParse(input);
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
    if (updates.categoryId) {
      const category = await db.query.resourceCategory.findFirst({
        where: and(
          eq(resourceCategory.id, updates.categoryId),
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
    }

    if (updates.locationId) {
      const location = await db.query.organizationLocation.findFirst({
        where: and(
          eq(organizationLocation.id, updates.locationId),
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

    const [result] = await db
      .update(resource)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(resource.id, id),
          eq(resource.organizationId, organizationId),
          notDeleted(resource)
        )
      )
      .returning();

    if (!result) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Resource not found'));
    }

    return ok(result);
  } catch (error) {
    logError('resources.updateResource', error, {
      feature: 'resources',
      extra: { id, organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to update resource')
    );
  }
};

export const updateResource = (db: DbConnection, input: UpdateResourceInput) =>
  trackedResult(
    'resources.updateResource',
    () => withOrgScope((tx) => updateResourceImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );

export type UpdateResourceResult = Awaited<ReturnType<typeof updateResource>>;
