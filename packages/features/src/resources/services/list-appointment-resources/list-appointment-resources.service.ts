import {
  appointment,
  appointmentResource,
  resource,
  withOrgScope,
} from '@borradh-workspace/database';
import { activeAppointmentStatuses } from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, gt, inArray, lt } from 'drizzle-orm';
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
import type { AppointmentResourceAllocationView } from '../../models/index.js';
import {
  type ListAppointmentResourcesInput,
  listAppointmentResourcesSchema,
} from './list-appointment-resources.schema.js';

/**
 * Allocations overlapping a window, hydrated with the resource's display
 * fields — the rooms calendar's one hydration query.
 *
 * The returned range is the HOLD, not the appointment: `endDate` already
 * includes `turnaroundMinutes`, and that field is carried through so the
 * calendar can render the cleanup tail as a hatched extension rather than as
 * bookable time.
 *
 * Half-open overlap (`start < to AND end > from`) so an allocation ending
 * exactly at the window start is excluded, matching every other range query in
 * scheduling.
 */
const listAppointmentResourcesImpl = async (
  db: DbConnection,
  input: ListAppointmentResourcesInput
): Promise<Result<AppointmentResourceAllocationView[]>> => {
  const parsed = listAppointmentResourcesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, from, to, locationId } = parsed.data;

  if (to <= from) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, '`to` must be after `from`')
    );
  }

  try {
    const rows = await db
      .select({
        id: appointmentResource.id,
        appointmentId: appointmentResource.appointmentId,
        resourceId: appointmentResource.resourceId,
        startDate: appointmentResource.startDate,
        endDate: appointmentResource.endDate,
        turnaroundMinutes: appointmentResource.turnaroundMinutes,
        source: appointmentResource.source,
        allowOverlap: appointmentResource.allowOverlap,
        resourceName: resource.name,
        resourceColor: resource.color,
        categoryId: resource.categoryId,
      })
      .from(appointmentResource)
      .innerJoin(resource, eq(appointmentResource.resourceId, resource.id))
      // Joined for the status filter below, not for any column.
      .innerJoin(
        appointment,
        eq(appointmentResource.appointmentId, appointment.id)
      )
      .where(
        and(
          eq(appointmentResource.organizationId, organizationId),
          notDeleted(resource),
          // Allocations ARE released when an appointment is cancelled, so in
          // theory this filter is redundant. In practice a leaked hold renders
          // as an occupied room with no clickable booking behind it — an
          // un-freeable room, in the one view whose whole job is to say which
          // rooms are free. `getResourceUtilisation` defends against the same
          // leak for the same reason; the calendar had the exposure and no
          // defence.
          notDeleted(appointment),
          inArray(appointment.status, [...activeAppointmentStatuses]),
          lt(appointmentResource.startDate, to),
          gt(appointmentResource.endDate, from),
          // Without this the rooms calendar is org-wide: one branch's day shows
          // another branch's bookings as occupied rooms it cannot free.
          locationId
            ? atLocationOrUnscoped(resource.locationId, locationId)
            : undefined
        )
      );

    return ok(rows);
  } catch (error) {
    logError('resources.listAppointmentResources', error, {
      feature: 'resources',
      extra: { organizationId, locationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to load resource allocations'
      )
    );
  }
};

export const listAppointmentResources = (
  db: DbConnection,
  input: ListAppointmentResourcesInput
) =>
  trackedResult(
    'resources.listAppointmentResources',
    () => withOrgScope((tx) => listAppointmentResourcesImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type ListAppointmentResourcesResult = Awaited<
  ReturnType<typeof listAppointmentResources>
>;
