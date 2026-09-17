import {
  type WorkingHours,
  appointmentResource,
  resource,
} from '@borradh-workspace/database';
import { and, eq, gt, inArray, lt, notInArray } from 'drizzle-orm';
import {
  type DbConnection,
  notDeleted,
  zonedWallTimeToUtc,
} from '../../../shared/index.js';

export interface ResourceBusyRange {
  start: Date;
  end: Date;
}

export interface ResolveResourceAvailabilityInput {
  organizationId: string;
  resourceIds: string[];
  from: Date;
  to: Date;
  /** IANA tz (organization.timezone) — workingHours wall-clock resolves in this zone. */
  timeZone: string;
  /** Allocations for these appointments are ignored (a reschedule must not conflict with itself). */
  excludeAppointmentIds?: string[];
}

export interface ResolvedResourceAvailability {
  resourceId: string;
  capacity: number;
  /** Open intervals. workingHours === null ⇒ open for the WHOLE window. */
  working: ResourceBusyRange[];
  /** Allocation ranges from appointment_resource (already include turnaround tails). */
  busy: ResourceBusyRange[];
}

/**
 * Resolve real availability for a set of resources (rooms, lasers, chairs) over
 * a window — the mirror of `resolveAvailability` for the non-human half of the
 * schedule. Composes, per resource:
 *
 *   working = working_hours expanded across the window, or the WHOLE window
 *             when working_hours is null (see below)
 *   busy    = appointment_resource allocations overlapping the window
 *
 * `workingHours === null` means ALWAYS OPEN, deliberately unlike Boulevard,
 * where a resource that was never given a schedule is silently never bookable —
 * a documented footgun that turns "we forgot to set Room 2's hours" into "Room 2
 * has no availability, ever". Most clinics want the room open whenever the
 * clinic is; only rented/shared rooms need their own hours.
 *
 * NO JOIN BACK TO `appointment.status`. Allocation rows exist only while the
 * appointment is active — cancel / no-show / delete / deposit-expiry release
 * them (`releaseAppointmentResources`). That lifecycle invariant is the whole
 * reason this can be a single indexed range query. If allocations ever start
 * outliving their appointment, every consumer of this function silently
 * over-blocks.
 *
 * Soft-deleted and deactivated resources are dropped entirely rather than
 * returned with empty working hours: a caller that sees no entry cannot
 * accidentally treat the resource as bookable.
 *
 * NOTE: expects to run inside an org scope (withOrgScope / withPublicOrgScope);
 * it issues raw queries on the passed connection and does not open its own scope.
 */
export async function resolveResourceAvailability(
  db: DbConnection,
  input: ResolveResourceAvailabilityInput
): Promise<ResolvedResourceAvailability[]> {
  const {
    organizationId,
    resourceIds,
    from,
    to,
    timeZone,
    excludeAppointmentIds,
  } = input;

  if (resourceIds.length === 0) return [];

  // ── Resources ─────────────────────────────────────────────────────────────
  // Explicit column list, NOT select(*). This resolver runs as `app_public` for
  // the unauthenticated booking widget, which is granted SELECT on ONLY these
  // columns (migration 0148) — name / description / photo / specs / color are
  // clinic-internal ("Room 2 — back corridor", "Lumenis M22") and are never
  // needed to answer "is an eligible resource free at 14:00?". Selecting an
  // ungranted column raises "permission denied", which the booking service
  // swallows into an EMPTY-SLOTS result rather than a visible error. Keep this
  // list and the grant IN STEP.
  const resourceRows = await db
    .select({
      id: resource.id,
      capacity: resource.capacity,
      workingHours: resource.workingHours,
    })
    .from(resource)
    .where(
      and(
        eq(resource.organizationId, organizationId),
        inArray(resource.id, resourceIds),
        eq(resource.isActive, true),
        notDeleted(resource)
      )
    );

  if (resourceRows.length === 0) return [];

  // ── Allocations ───────────────────────────────────────────────────────────
  // Half-open overlap with the window: start < to AND end > from. Explicit
  // column list again — see the note above; nothing sensitive lives on this
  // table today, but a future column must default to NOT being public.
  const allocationRows = await db
    .select({
      resourceId: appointmentResource.resourceId,
      startDate: appointmentResource.startDate,
      endDate: appointmentResource.endDate,
    })
    .from(appointmentResource)
    .where(
      and(
        eq(appointmentResource.organizationId, organizationId),
        inArray(appointmentResource.resourceId, resourceIds),
        lt(appointmentResource.startDate, to),
        gt(appointmentResource.endDate, from),
        // A reschedule must not conflict with the appointment being moved, so
        // its own holds are excluded from the busy set it is checked against.
        excludeAppointmentIds && excludeAppointmentIds.length > 0
          ? notInArray(appointmentResource.appointmentId, excludeAppointmentIds)
          : undefined
      )
    );

  const busyByResource = new Map<string, ResourceBusyRange[]>();
  for (const row of allocationRows) {
    const list = busyByResource.get(row.resourceId) ?? [];
    // The stored range ALREADY includes the turnaround tail (that is why
    // appointment_resource carries its own dates instead of reading the
    // appointment's) — do not add turnaroundMinutes again here.
    list.push({ start: row.startDate, end: row.endDate });
    busyByResource.set(row.resourceId, list);
  }

  const byId = new Map(resourceRows.map((row) => [row.id, row]));

  // Preserve the caller's `resourceIds` order so downstream tie-breaks (e.g.
  // pickResourcesFor) are deterministic.
  const results: ResolvedResourceAvailability[] = [];
  for (const resourceId of resourceIds) {
    const row = byId.get(resourceId);
    if (!row) continue;
    results.push({
      resourceId,
      capacity: row.capacity,
      working: expandResourceWorkingHours(row.workingHours, from, to, timeZone),
      busy: busyByResource.get(resourceId) ?? [],
    });
  }
  return results;
}

/**
 * Expand a resource's weekly `WorkingHours` (`Record<0..6, {from,to}>`, minutes
 * from midnight) into UTC intervals clamped to the window.
 *
 * Null hours ⇒ the whole window, per the "null = always open" rule above.
 *
 * Wall-clock minutes resolve through `zonedWallTimeToUtc` in the org's zone,
 * exactly as shifts do, so "09:00" is 08:00Z in Dublin summer and 09:00Z in
 * winter regardless of what zone the server happens to run in. Days are walked
 * with a day of padding either side because the UTC instant of a zoned day's
 * opening time can fall outside the window's own UTC day.
 */
function expandResourceWorkingHours(
  hours: WorkingHours | null,
  from: Date,
  to: Date,
  timeZone: string
): ResourceBusyRange[] {
  if (from >= to) return [];
  if (!hours) return [{ start: from, end: to }];

  const ranges: ResourceBusyRange[] = [];
  // Cursor is a UTC midnight, so getUTCDay() is the true weekday of the
  // calendar date the cursor names.
  const cursor = utcMidnight(from);
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  const last = utcMidnight(to);
  last.setUTCDate(last.getUTCDate() + 1);

  while (cursor <= last) {
    const spec = hours[cursor.getUTCDay()];
    if (spec && spec.to > spec.from) {
      const dateStr = cursor.toISOString().slice(0, 10);
      const dayStart = zonedWallTimeToUtc(dateStr, spec.from, timeZone);
      const dayEnd = zonedWallTimeToUtc(dateStr, spec.to, timeZone);
      const start = dayStart < from ? from : dayStart;
      const end = dayEnd > to ? to : dayEnd;
      if (start < end) ranges.push({ start, end });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return ranges;
}

/** Midnight UTC of the calendar date an instant falls on. */
function utcMidnight(instant: Date): Date {
  return new Date(
    Date.UTC(
      instant.getUTCFullYear(),
      instant.getUTCMonth(),
      instant.getUTCDate()
    )
  );
}
