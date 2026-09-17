import {
  appointment,
  appointmentResource,
  appointmentService,
  isDeadlock,
  isExclusionViolation,
  isUniqueViolation,
  organizationService,
  resource,
  serviceResourceRequirement,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, gt, inArray, lt, ne } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import type { AppointmentResourceAllocationView } from '../../models/index.js';
import {
  type ReassignAppointmentResourceInput,
  reassignAppointmentResourceSchema,
} from './reassign-appointment-resource.schema.js';

/**
 * The range a NEW hold should occupy: the appointment's own window, extended
 * by the turnaround of whichever of the appointment's services requires this
 * category.
 *
 * Zero when nothing in the cart requires the category — assigning a room to a
 * service that does not demand one is a valid thing for staff to do, and it
 * carries no cleanup time of its own.
 */
async function deriveHoldWindow(
  db: DbConnection,
  args: {
    organizationId: string;
    appointmentId: string;
    categoryId: string;
    startDate: Date;
    endDate: Date;
  }
): Promise<{ startDate: Date; endDate: Date; turnaroundMinutes: number }> {
  const serviceIds = (
    await db
      .select({ serviceId: appointmentService.serviceId })
      .from(appointmentService)
      .where(eq(appointmentService.appointmentId, args.appointmentId))
  )
    .map((row) => row.serviceId)
    .filter((id): id is string => !!id);

  let turnaroundMinutes = 0;
  if (serviceIds.length > 0) {
    const rows = await db
      .select({ minutes: organizationService.turnaroundMinutes })
      .from(serviceResourceRequirement)
      .innerJoin(
        organizationService,
        eq(serviceResourceRequirement.serviceId, organizationService.id)
      )
      .where(
        and(
          eq(serviceResourceRequirement.organizationId, args.organizationId),
          eq(serviceResourceRequirement.categoryId, args.categoryId),
          inArray(serviceResourceRequirement.serviceId, serviceIds)
        )
      );
    for (const row of rows) {
      turnaroundMinutes = Math.max(turnaroundMinutes, row.minutes ?? 0);
    }
  }

  return {
    startDate: args.startDate,
    endDate: new Date(args.endDate.getTime() + turnaroundMinutes * 60_000),
    turnaroundMinutes,
  };
}

/**
 * "Somebody got there first" — the three ways a concurrent room grab loses.
 *
 * `resource_no_overlap` is the exclusion constraint on a MOVE; the unique index
 * is the same race on an ASSIGN (same room, same appointment, e.g. a
 * double-click). Both mean the row the caller wanted is gone, which is a
 * CONFLICT the UI can offer Force for — never a 500.
 *
 * A DEADLOCK is the same loss wearing a different SQLSTATE. Postgres enforces
 * an exclusion constraint by making each inserter wait on the transaction that
 * owns a conflicting index entry, so two moves onto the same room each wait on
 * the other and one is killed with 40P01 instead of either being told 23P01.
 * Which of the two codes you get is a matter of interleaving, and the loser
 * used to fall through to INTERNAL_ERROR — a 500 at the front desk for the
 * ordinary act of two people grabbing the same room, and only ever under enough
 * load to produce the cycle. CI caught it; twenty-six passing local runs did
 * not.
 *
 * A deadlock carries no constraint name, so this is only sound because the
 * transaction is small: it locks ONE appointment row and writes at most ONE
 * `appointment_resource` row, and every other statement is a read. There is no
 * second pair of objects here to deadlock over, so a cycle can only be another
 * writer contending for the same hold. The victim is rolled back in full, so
 * nothing partial was written and CONFLICT is the honest answer.
 */
function isResourceRaceLoss(error: unknown): boolean {
  return (
    isExclusionViolation(error, 'resource_no_overlap') ||
    isUniqueViolation(error, 'appointment_resource_unique') ||
    isDeadlock(error)
  );
}

/**
 * Set ONE of an appointment's held resources — the write behind
 * drag-to-reassign, the side-panel dropdown and the override popover.
 *
 * It covers all three transitions, because the front desk makes all three:
 *
 *   - MOVE   — the category already holds a room; swap which one.
 *   - ASSIGN — the category holds nothing; create the hold. This is the
 *     ordinary case for every booking made before rooms existed, and for any
 *     service that requires no room but is physically going to occupy one.
 *   - RELEASE — `resourceId: null`; drop the hold and free the room.
 *
 * Scope is deliberately narrow: it changes WHICH resource is held, never the
 * time. A sideways drag on the rooms calendar must not silently reschedule a
 * client's appointment; rescheduling stays on the bookings calendar where it
 * carries a notify-the-client confirmation.
 *
 * The hold's range is preserved verbatim, turnaround tail included, so a move
 * cannot quietly change how long the room is blocked for.
 *
 * CONFLICTS. A clash is a normal outcome here, not an error: the front desk is
 * often moving things around precisely because the diary is tight. Without
 * `force` the clash is refused with CONFLICT so the UI can offer the override;
 * with it the row is written `allowOverlap: true`, opting out of the
 * `resource_no_overlap` constraint the same way a warn-don't-block console
 * booking does.
 */
const reassignAppointmentResourceImpl = async (
  db: DbConnection,
  input: ReassignAppointmentResourceInput
): Promise<Result<AppointmentResourceAllocationView | null>> => {
  const parsed = reassignAppointmentResourceSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, appointmentId, categoryId, resourceId, force } =
    parsed.data;

  try {
    // ONE TRANSACTION, and the FOR UPDATE below is load-bearing.
    //
    // The ASSIGN path below is a check-then-INSERT: read "this category holds
    // nothing", then write a hold. Two requests racing that read — a
    // double-click on the dropdown is enough — both saw nothing and both
    // inserted, leaving the booking holding TWO rooms in one category. Nothing
    // in the schema stops it: `appointment_resource_unique` is
    // (appointment_id, resource_id) and `resource_no_overlap` is
    // (resource_id, range), so two DIFFERENT rooms violate neither. The second
    // room then became unreachable — `current` is a LIMIT 1 with no ORDER BY,
    // so a later move or release touched whichever row came back first, and
    // the other stayed held until the appointment was cancelled.
    //
    // Locking the APPOINTMENT (not the allocation, which may not exist yet)
    // serialises every write to that booking's holds, which is exactly the
    // grain the invariant lives at: one resource per category per appointment.
    const [appt] = await db
      .select({
        id: appointment.id,
        startDate: appointment.startDate,
        endDate: appointment.endDate,
      })
      .from(appointment)
      .where(
        and(
          eq(appointment.id, appointmentId),
          eq(appointment.organizationId, organizationId),
          notDeleted(appointment)
        )
      )
      .limit(1)
      .for('update');
    if (!appt) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Appointment not found')
      );
    }

    // The existing hold for this category — the row being moved. Found by
    // joining through `resource`, since the allocation itself only knows its
    // resource, not the category.
    const [current] = await db
      .select({
        id: appointmentResource.id,
        startDate: appointmentResource.startDate,
        endDate: appointmentResource.endDate,
        turnaroundMinutes: appointmentResource.turnaroundMinutes,
      })
      .from(appointmentResource)
      .innerJoin(resource, eq(appointmentResource.resourceId, resource.id))
      .where(
        and(
          eq(appointmentResource.appointmentId, appointmentId),
          eq(appointmentResource.organizationId, organizationId),
          eq(resource.categoryId, categoryId)
        )
      )
      .limit(1);

    // RELEASE. Idempotent on purpose — "make sure nothing is held here" is
    // the operator's intent, and a second click must not be an error.
    if (resourceId === null) {
      if (current) {
        await db
          .delete(appointmentResource)
          .where(eq(appointmentResource.id, current.id));
      }
      return ok(null);
    }

    // The target must be a live resource in the category being reassigned —
    // otherwise a stale UI could move a booking into another category's slot.
    const target = await db.query.resource.findFirst({
      where: and(
        eq(resource.id, resourceId),
        eq(resource.organizationId, organizationId),
        eq(resource.categoryId, categoryId),
        notDeleted(resource)
      ),
    });
    if (!target) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'That room is not available in this category'
        )
      );
    }
    if (!target.isActive) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          `${target.name} is deactivated and cannot take bookings`
        )
      );
    }

    // The window the hold occupies. An existing hold's range is preserved
    // VERBATIM, turnaround tail included, so a move cannot quietly change how
    // long the room is blocked for. A first-time assignment has no range to
    // preserve, so it is derived from the appointment plus whatever turnaround
    // this category's requirement carries.
    const hold = current
      ? {
          startDate: current.startDate,
          endDate: current.endDate,
          turnaroundMinutes: current.turnaroundMinutes,
        }
      : await deriveHoldWindow(db, {
          organizationId,
          appointmentId,
          categoryId,
          startDate: appt.startDate,
          endDate: appt.endDate,
        });

    // Capacity check. The DB exclusion constraint only guards capacity-1
    // resources, so counting here is what makes `capacity > 1` correct — and
    // it is also what produces a friendly CONFLICT instead of a raw PG error
    // for the common single-occupancy case.
    if (!force) {
      const clashes = await db
        .select({ id: appointmentResource.id })
        .from(appointmentResource)
        .where(
          and(
            eq(appointmentResource.organizationId, organizationId),
            eq(appointmentResource.resourceId, resourceId),
            current ? ne(appointmentResource.id, current.id) : undefined,
            lt(appointmentResource.startDate, hold.endDate),
            gt(appointmentResource.endDate, hold.startDate)
          )
        );

      if (clashes.length >= target.capacity) {
        return err(
          new FeatureError(
            ErrorCodes.CONFLICT,
            `${target.name} is already booked for that time`,
            { resourceId, resourceName: target.name }
          )
        );
      }
    }

    // Forced moves and every hold on a shared resource opt out of the
    // exclusion constraint — see the note in schema/resource.ts.
    const allowOverlap = force || target.capacity > 1;

    const [updated] = current
      ? await db
          .update(appointmentResource)
          .set({ resourceId, source: 'manual', allowOverlap })
          .where(eq(appointmentResource.id, current.id))
          .returning()
      : await db
          .insert(appointmentResource)
          .values({
            organizationId,
            appointmentId,
            resourceId,
            startDate: hold.startDate,
            endDate: hold.endDate,
            turnaroundMinutes: hold.turnaroundMinutes,
            source: 'manual',
            allowOverlap,
          })
          .returning();

    return ok({
      id: updated.id,
      appointmentId,
      resourceId: updated.resourceId,
      resourceName: target.name,
      resourceColor: target.color ?? null,
      categoryId,
      startDate: updated.startDate,
      endDate: updated.endDate,
      turnaroundMinutes: updated.turnaroundMinutes,
      source: updated.source,
      allowOverlap: updated.allowOverlap,
    });
  } catch (error) {
    // ⚠️ A constraint violation must LEAVE this function by throwing.
    //
    // The impl runs inside `tx.transaction(...)`. A failed statement has
    // already put Postgres into an aborted transaction, so RETURNING a mapped
    // Result here makes drizzle try to COMMIT it — and committing an aborted
    // transaction throws in turn. That second error escapes past this catch to
    // `trackedResult`, which correctly calls anything unexpected an
    // INTERNAL_ERROR. Net effect: the loser of a room race got a 500 with a
    // "conflicting key value violates exclusion constraint" in the logs, but
    // only sometimes — whenever the DB rather than the pre-check caught the
    // clash. Throwing rolls the transaction back cleanly and lets the wrapper
    // below classify it. See `isResourceRaceLoss`.
    if (isResourceRaceLoss(error)) throw error;

    logError('resources.reassignAppointmentResource', error, {
      feature: 'resources',
      extra: { organizationId, appointmentId, categoryId, resourceId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to move the booking')
    );
  }
};

export const reassignAppointmentResource = (
  db: DbConnection,
  input: ReassignAppointmentResourceInput
) =>
  trackedResult(
    'resources.reassignAppointmentResource',
    () =>
      // The impl's own transaction, NOT `withOrgScope`'s. `withOrgScope`
      // passes straight through when RLS is disabled — no transaction at all —
      // and the row lock it takes would be released the instant the statement
      // ended, which is exactly how two concurrent assigns both got through.
      // Classified OUT HERE, after the transaction has rolled back — see the
      // note in the impl's catch.
      withOrgScope(
        (tx) =>
          tx.transaction((inner) =>
            reassignAppointmentResourceImpl(inner, input)
          ),
        { db }
      ).catch((error: unknown) => {
        if (isResourceRaceLoss(error)) {
          return err(
            new FeatureError(
              ErrorCodes.CONFLICT,
              'That room was just taken — pick another.'
            )
          );
        }
        throw error;
      }),
    {
      properties: {
        organizationId: input.organizationId,
        appointmentId: input.appointmentId,
      },
    }
  );

export type ReassignAppointmentResourceResult = Awaited<
  ReturnType<typeof reassignAppointmentResource>
>;
