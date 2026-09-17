import {
  appointmentResource,
  resource,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, gt } from 'drizzle-orm';
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
  type DeleteResourceInput,
  deleteResourceSchema,
} from './delete-resource.schema.js';

/**
 * SOFT delete, blocked while the resource still holds FUTURE allocations.
 *
 * `appointment_resource.resource_id` is ON DELETE RESTRICT precisely so this can
 * never silently succeed — this check turns that DB restriction into an error
 * that names the count and points at the fix (deactivate) BEFORE Postgres ever
 * sees the statement.
 *
 * Only allocations whose hold has not yet ended count: a resource booked solid
 * last year is perfectly deletable.
 */
const deleteResourceImpl = async (
  db: DbConnection,
  input: DeleteResourceInput
): Promise<Result<{ id: string }>> => {
  const parsed = deleteResourceSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId } = parsed.data;

  try {
    const existing = await db.query.resource.findFirst({
      where: and(
        eq(resource.id, id),
        eq(resource.organizationId, organizationId),
        notDeleted(resource)
      ),
      columns: { id: true, name: true },
    });

    if (!existing) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Resource not found'));
    }

    const upcoming = await db.query.appointmentResource.findMany({
      where: and(
        eq(appointmentResource.resourceId, id),
        eq(appointmentResource.organizationId, organizationId),
        gt(appointmentResource.endDate, new Date())
      ),
      columns: { id: true },
    });

    if (upcoming.length > 0) {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          `${existing.name} has ${upcoming.length} upcoming ${pluralize(
            upcoming.length,
            'booking'
          )}. Deactivate it instead, or move those bookings first.`,
          { upcomingAllocationCount: upcoming.length }
        )
      );
    }

    await db
      .update(resource)
      .set({ deletedAt: new Date() })
      .where(
        and(eq(resource.id, id), eq(resource.organizationId, organizationId))
      );

    return ok({ id });
  } catch (error) {
    logError('resources.deleteResource', error, {
      feature: 'resources',
      extra: { id, organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to delete resource')
    );
  }
};

export const deleteResource = (db: DbConnection, input: DeleteResourceInput) =>
  trackedResult(
    'resources.deleteResource',
    () => withOrgScope((tx) => deleteResourceImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );

export type DeleteResourceResult = Awaited<ReturnType<typeof deleteResource>>;
