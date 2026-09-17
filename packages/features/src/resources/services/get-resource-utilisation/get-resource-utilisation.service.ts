import {
  type WorkingHours,
  appointment,
  appointmentResource,
  appointmentService,
  organization,
  organizationLocation,
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
  addDays,
  atLocationOrUnscoped,
  err,
  notDeleted,
  ok,
  zonedDateString,
  zonedWallTimeToUtc,
} from '../../../shared/index.js';
import type {
  ResourceUtilisationResponse,
  ResourceUtilisationRow,
} from '../../models/index.js';
import {
  type GetResourceUtilisationInput,
  getResourceUtilisationSchema,
} from './get-resource-utilisation.schema.js';

/** A weekly opening-hours record: day-of-week (0=Sun) → minutes from midnight. */
type OpeningHours = WorkingHours;

/** The day-of-week (0=Sunday) of a `YYYY-MM-DD` calendar date. */
function dayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Whole minutes two half-open instant ranges share. Never negative. */
function overlapMinutes(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): number {
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min(aEnd.getTime(), bEnd.getTime());
  return end <= start ? 0 : Math.round((end - start) / 60_000);
}

/**
 * Minutes a weekly opening-hours record is OPEN inside `[windowStart, windowEnd)`.
 *
 * Walks calendar days in the ORG's zone — not UTC — because opening hours are
 * wall-clock ("09:00–18:00") and a DST change moves the instant that maps to,
 * not the hours worked. Days are clipped to the window, so a report starting
 * mid-morning counts only the remainder of that day.
 */
function openMinutesInWindow(
  hours: OpeningHours | null | undefined,
  windowStart: Date,
  windowEnd: Date,
  timeZone: string
): number {
  if (!hours) return 0;

  let total = 0;
  // `YYYY-MM-DD` sorts lexicographically = chronologically, so the string
  // comparison is a safe loop bound and terminates on the strictly increasing
  // `addDays`. The last day is included because `windowEnd`'s own wall-clock
  // time may fall after that day's opening time; the clip handles the rest.
  const lastDay = zonedDateString(windowEnd, timeZone);
  let day = zonedDateString(windowStart, timeZone);

  while (day <= lastDay) {
    const interval = hours[dayOfWeek(day)];
    // `from === to` is the stored convention for "closed that day".
    if (interval && interval.to > interval.from) {
      total += overlapMinutes(
        zonedWallTimeToUtc(day, interval.from, timeZone),
        zonedWallTimeToUtc(day, interval.to, timeZone),
        windowStart,
        windowEnd
      );
    }
    day = addDays(day, 1);
  }

  return total;
}

/** Ratio rounded to 4dp — enough precision for a %, no float noise in snapshots. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Room utilisation and revenue per open room-hour over a reporting window.
 *
 * This is the number an owner makes staffing and capex decisions on (the
 * industry benchmark is 75–85% treatment-room utilisation), so every judgement
 * call below is deliberate and stated:
 *
 * **The denominator (`openMinutes`) — the fallback chain.**
 *   1. the resource's own `workingHours`, when it has them;
 *   2. else its own LOCATION's opening hours, when it has a location;
 *   3. else, when the report is SCOPED to a `locationId`, that location's
 *      opening hours;
 *   4. else the org's primary location's opening hours;
 *   5. else `organization.businessHours` (which is exactly what a location's
 *      null `openingHours` means);
 *   6. else 0.
 *
 *   `workingHours === null` means "always available" for BOOKING, and it is
 *   tempting to read that as a 24h denominator here. That would be wrong: a
 *   room that is notionally always available is not open at 3am, and a 24h
 *   denominator divides every clinic's figure by ~3, turning a healthy 80%
 *   into a meaningless 27%. Opening hours are the honest denominator.
 *
 *   Step 3 is why a location-LESS resource (a trolley-mounted device, available
 *   everywhere) does not fall straight through to the primary location. The
 *   question a filtered report asks is "how utilised is this AT Location B",
 *   and answering it with the primary's hours silently mixes two different
 *   questions — understating the branch the user actually asked about whenever
 *   the primary happens to open longer.
 *
 * **The numerator (`bookedMinutes`)** sums allocation time CLIPPED to the
 * window, and INCLUDES turnaround: the room is genuinely occupied during
 * cleanup, and excluding it would flatter the number.
 *
 * **Revenue attribution.** An appointment's total is split EVENLY across the
 * distinct resources it holds in this report, so an appointment using a room
 * and a laser contributes half to each and category subtotals reconcile to the
 * appointment total instead of double-counting it. Any odd cent goes to the
 * lowest `resourceId`, so the split sums back to the total exactly rather than
 * drifting. Resources this report does not count (deleted, inactive, filtered
 * out by location) are not given a share to swallow.
 *
 * **Only ACTIVE appointments count.** Cancelled/no-show allocations are
 * supposed to be released, but this joins back to `appointment` and filters on
 * status + `deletedAt` anyway: a leaked allocation must not silently inflate a
 * customer-facing revenue figure.
 *
 * `utilisation` is a 0..1 RATIO, not a percentage — the UI formats it. It is
 * not clamped: a capacity > 1 resource legitimately exceeds 1.0, and hiding
 * that would hide genuine over-allocation.
 */
const getResourceUtilisationImpl = async (
  db: DbConnection,
  input: GetResourceUtilisationInput
): Promise<Result<ResourceUtilisationResponse>> => {
  const parsed = getResourceUtilisationSchema.safeParse(input);
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
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
      columns: { timezone: true, businessHours: true },
    });

    // `organization.timezone` is NOT NULL DEFAULT 'UTC'; the ?? only covers a
    // missing row, which org scoping already makes impossible.
    const timeZone = org?.timezone || 'UTC';
    const orgBusinessHours = (org?.businessHours ??
      null) as OpeningHours | null;

    const resourceRows = await db.query.resource.findMany({
      where: and(
        eq(resource.organizationId, organizationId),
        notDeleted(resource),
        eq(resource.isActive, true),
        // A location-less resource is available everywhere, so it belongs in
        // every location's report.
        locationId
          ? atLocationOrUnscoped(resource.locationId, locationId)
          : undefined
      ),
      with: {
        category: { columns: { id: true, name: true, sortOrder: true } },
      },
    });

    if (resourceRows.length === 0) {
      return ok({ from, to, rows: [] });
    }

    const locations = await db.query.organizationLocation.findMany({
      where: eq(organizationLocation.organizationId, organizationId),
      columns: { id: true, openingHours: true, isPrimary: true },
    });
    const locationById = new Map(locations.map((l) => [l.id, l]));
    const primaryLocation = locations.find((l) => l.isPrimary) ?? null;
    // The location a resource with no location of its own is measured against:
    // the one this report is scoped to, else the org's primary. See the
    // denominator chain in the doc-comment for why the filter wins here.
    const scopedLocation = locationId
      ? (locationById.get(locationId) ?? null)
      : primaryLocation;

    const resourceIds = resourceRows.map((r) => r.id);

    const allocations = await db
      .select({
        appointmentId: appointmentResource.appointmentId,
        resourceId: appointmentResource.resourceId,
        startDate: appointmentResource.startDate,
        endDate: appointmentResource.endDate,
      })
      .from(appointmentResource)
      .innerJoin(
        appointment,
        eq(appointmentResource.appointmentId, appointment.id)
      )
      .where(
        and(
          eq(appointmentResource.organizationId, organizationId),
          inArray(appointmentResource.resourceId, resourceIds),
          // Half-open overlap, matching every other range query in scheduling.
          lt(appointmentResource.startDate, to),
          gt(appointmentResource.endDate, from),
          notDeleted(appointment),
          inArray(appointment.status, [...activeAppointmentStatuses])
        )
      );

    // ── Booked minutes, clipped to the window ────────────────────────────────
    const bookedByResource = new Map<string, number>();
    const resourcesByAppointment = new Map<string, Set<string>>();

    for (const alloc of allocations) {
      const minutes = overlapMinutes(
        new Date(alloc.startDate),
        new Date(alloc.endDate),
        from,
        to
      );
      bookedByResource.set(
        alloc.resourceId,
        (bookedByResource.get(alloc.resourceId) ?? 0) + minutes
      );

      const held = resourcesByAppointment.get(alloc.appointmentId);
      if (held) held.add(alloc.resourceId);
      else
        resourcesByAppointment.set(
          alloc.appointmentId,
          new Set([alloc.resourceId])
        );
    }

    // ── Revenue, split evenly across the resources each appointment holds ────
    const revenueByResource = new Map<string, number>();
    const appointmentIds = [...resourcesByAppointment.keys()];

    if (appointmentIds.length > 0) {
      const lines = await db.query.appointmentService.findMany({
        where: inArray(appointmentService.appointmentId, appointmentIds),
        columns: { appointmentId: true, priceCents: true },
        with: { service: { columns: { priceCents: true } } },
      });

      const totalByAppointment = new Map<string, number>();
      for (const line of lines) {
        // The line-item snapshot wins; the live catalogue price is the fallback
        // for rows booked before pricing was captured; then 0.
        const price = line.priceCents ?? line.service?.priceCents ?? 0;
        totalByAppointment.set(
          line.appointmentId,
          (totalByAppointment.get(line.appointmentId) ?? 0) + price
        );
      }

      for (const [appointmentId, heldIds] of resourcesByAppointment) {
        const total = totalByAppointment.get(appointmentId) ?? 0;
        // Sorted so "the lowest resourceId absorbs the remainder" is a stable,
        // reproducible rule rather than whatever order the rows arrived in.
        const ids = [...heldIds].sort();
        const share = Math.floor(total / ids.length);
        const remainder = total - share * ids.length;

        ids.forEach((id, index) => {
          const attributed = share + (index === 0 ? remainder : 0);
          revenueByResource.set(
            id,
            (revenueByResource.get(id) ?? 0) + attributed
          );
        });
      }
    }

    // ── Rows ─────────────────────────────────────────────────────────────────
    // Sorted the way the report renders: category order, then resource order,
    // then name — the same ordering `listResources` uses.
    const sorted = [...resourceRows].sort(
      (a, b) =>
        (a.category?.sortOrder ?? 0) - (b.category?.sortOrder ?? 0) ||
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name)
    );

    const rows: ResourceUtilisationRow[] = sorted.map((row) => {
      // A resolved location whose `openingHours` is null means "inherit
      // organization.businessHours" — its documented meaning — which is what
      // the ?? chain below then does.
      const fallbackLocation = row.locationId
        ? (locationById.get(row.locationId) ?? null)
        : scopedLocation;

      const hours =
        row.workingHours ??
        (fallbackLocation?.openingHours as OpeningHours | null | undefined) ??
        orgBusinessHours;

      const openMinutes = openMinutesInWindow(hours, from, to, timeZone);
      const bookedMinutes = bookedByResource.get(row.id) ?? 0;
      const revenueCents = revenueByResource.get(row.id) ?? 0;

      return {
        resourceId: row.id,
        resourceName: row.name,
        categoryId: row.category.id,
        categoryName: row.category.name,
        openMinutes,
        bookedMinutes,
        // Never NaN and never Infinity: a JSON NaN serialises to null and
        // renders as a blank cell that reads as a loading state.
        utilisation:
          openMinutes === 0 ? 0 : round4(bookedMinutes / openMinutes),
        revenueCents,
        revenuePerOpenHourCents:
          openMinutes === 0 ? 0 : Math.round(revenueCents / (openMinutes / 60)),
      };
    });

    return ok({ from, to, rows });
  } catch (error) {
    logError('resources.getResourceUtilisation', error, {
      feature: 'resources',
      extra: { organizationId, locationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to compute resource utilisation'
      )
    );
  }
};

export const getResourceUtilisation = (
  db: DbConnection,
  input: GetResourceUtilisationInput
) =>
  trackedResult(
    'resources.getResourceUtilisation',
    () => withOrgScope((tx) => getResourceUtilisationImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type GetResourceUtilisationResult = Awaited<
  ReturnType<typeof getResourceUtilisation>
>;
