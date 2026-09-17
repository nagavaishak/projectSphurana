import {
  type BlockedTimePractitioner,
  type Shift,
  type TimeOff,
  type WorkingHours,
  appointment,
  blockedTime,
  blockedTimeException,
  blockedTimePractitioner,
  shift,
  timeOff,
} from '@borradh-workspace/database';
import { activeAppointmentStatuses } from '@borradh-workspace/labels';
import {
  and,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
} from 'drizzle-orm';
import {
  type DbConnection,
  notDeleted,
  zonedWallTimeToUtc,
} from '../../../shared/index.js';
import {
  type BlockedTimeBusyException,
  expandBlockedTimeBusy,
} from '../../utils/expand-blocked-time.js';
import { expandTimeOff } from '../../utils/expand-time-off.js';
import { resolveShiftDays } from '../../utils/resolve-shift-days.js';

/**
 * The only time-off fields needed to compute a busy interval. `type`
 * ('sick_leave') and `description` are staff personal data: the public booking
 * widget runs as `app_public`, which is not granted them.
 */
type TimeOffBusySeries = Pick<
  TimeOff,
  | 'practitionerId'
  | 'startDate'
  | 'endDate'
  | 'rrule'
  | 'timezone'
  | 'recurrenceEndDate'
>;

export interface AvailabilityBusyRange {
  start: Date;
  end: Date;
}

/**
 * @deprecated No longer consulted. Availability is derived solely from `shift`
 * rows; a practitioner with no shifts is simply unavailable. This type and the
 * `fallbackHours` input are kept only so existing callers still type-check —
 * the values are ignored. Remove once all callers stop passing them.
 */
export interface PractitionerFallbackHours {
  practitionerId: string;
  workingHours: WorkingHours | null;
  locationWorkingHours: WorkingHours | null;
}

export interface ResolveAvailabilityInput {
  organizationId: string;
  practitionerIds: string[];
  from: Date;
  to: Date;
  /**
   * IANA time zone the business operates in (organization.timezone). Shift and
   * fallback working-hours wall-clock times are interpreted in this zone, so a
   * "09:00" shift resolves to the correct UTC instant regardless of server tz.
   */
  timeZone: string;
  /** Restrict shift rows to this location (null-location rows always apply). */
  locationId?: string | null;
  /**
   * @deprecated Ignored. Org/location opening hours are informational only
   * (they drive what the booking page + chatbot display), never bookability.
   */
  orgBusinessHours?: WorkingHours | null;
  /** @deprecated Ignored — see `orgBusinessHours`. */
  locationOpeningHours?: WorkingHours | null;
  /** @deprecated Ignored — opening-hours exceptions are display-only. */
  openingHoursExceptions?: OpeningHoursException[];
  /** @deprecated Ignored — availability is shifts-only. */
  fallbackHours?: PractitionerFallbackHours[];
  /** Extra busy ranges to subtract (e.g. external Google Calendar free/busy). */
  additionalBusyByPractitioner?: Record<string, AvailabilityBusyRange[]>;
}

/** A single-date override of a location's standing opening hours. */
export interface OpeningHoursException {
  /** YYYY-MM-DD (location/business time zone). */
  date: string;
  /** True = closed all day. */
  closed: boolean;
  /** Open-from minutes-from-midnight (only when not closed). */
  fromMinutes: number | null;
  /** Open-to minutes-from-midnight (only when not closed). */
  toMinutes: number | null;
}

export interface ResolvedPractitionerAvailability {
  practitionerId: string;
  /** On-shift working intervals within the window (Date ranges, local time). */
  working: AvailabilityBusyRange[];
  /** Everything that blocks a slot: time off + blocked time + appointments + external. */
  busy: AvailabilityBusyRange[];
}

/** UTC instant for a YYYY-MM-DD wall-clock date + minutes in the given tz. */
function dateAtMinutes(
  dateStr: string,
  minutes: number,
  timeZone: string
): Date {
  return zonedWallTimeToUtc(dateStr, minutes, timeZone);
}

/**
 * Resolve real availability for a set of practitioners over a window.
 *
 * Composes, per practitioner:
 *   working = resolveShiftDays(shift rows)   — shifts are the SOLE source; a
 *             practitioner with no shift rows has no working time and is not
 *             bookable. Org/location opening hours are NOT a fallback.
 *   busy    = time off ∪ blocked time ∪ active appointments ∪ external busy
 *
 * This is the single source of truth every consumer (calendar, chatbot, public
 * booking form, voice) should use. All math is in server-local time to match
 * the existing (timezone-naive) behaviour of the calendar and shift resolver.
 *
 * NOTE: expects to run inside an org scope (withOrgScope / withPublicOrgScope);
 * it issues raw queries on the passed connection and does not open its own scope.
 */
export async function resolveAvailability(
  db: DbConnection,
  input: ResolveAvailabilityInput
): Promise<ResolvedPractitionerAvailability[]> {
  const {
    organizationId,
    practitionerIds,
    from,
    to,
    timeZone,
    locationId,
    additionalBusyByPractitioner,
  } = input;

  if (practitionerIds.length === 0) return [];

  // ── Shifts ────────────────────────────────────────────────────────────────
  const shiftRows: Shift[] = await db
    .select()
    .from(shift)
    .where(
      and(
        eq(shift.organizationId, organizationId),
        inArray(shift.practitionerId, practitionerIds),
        locationId
          ? or(isNull(shift.locationId), eq(shift.locationId, locationId))
          : undefined
      )
    );

  // Shifts are the SOLE source of a practitioner's working intervals. A
  // practitioner with no shift rows in this window has no working time and is
  // therefore not bookable — availability is never inferred from org/location
  // opening hours or a per-practitioner static-hours field. (Those org-level
  // hours describe when the *business* can be open, not when a specific
  // practitioner works.) The `orgBusinessHours` / `locationOpeningHours` /
  // `fallbackHours` inputs are retained on the interface for callers but are no
  // longer consulted here.
  const resolvedDays = resolveShiftDays(shiftRows, from, to);
  const workingByPractitioner = new Map<string, AvailabilityBusyRange[]>();
  for (const day of resolvedDays) {
    if (day.isOff) continue;
    const list = workingByPractitioner.get(day.practitionerId) ?? [];
    for (const iv of day.intervals) {
      list.push({
        start: dateAtMinutes(day.date, iv.startMinutes, timeZone),
        end: dateAtMinutes(day.date, iv.endMinutes, timeZone),
      });
    }
    workingByPractitioner.set(day.practitionerId, list);
  }

  // Opening-hours exceptions are intentionally NOT applied here. Org/location
  // opening hours (standing and per-date exceptions) are informational only —
  // they drive what the booking page and chatbot display, never bookability. To
  // close a specific day for a practitioner, give them a shift day-off override;
  // to reshape a day, edit that day's shift.

  // ── Time off (per practitioner) ─────────────────────────────────────────────
  // Explicit column list, NOT select(*). This resolver runs as `app_public` for
  // the unauthenticated booking widget, which is granted SELECT on only these
  // columns — `time_off.type` ('sick_leave') and `.description` are staff
  // personal data and are never needed to compute a busy interval.
  const timeOffRows: TimeOffBusySeries[] = await db
    .select({
      practitionerId: timeOff.practitionerId,
      startDate: timeOff.startDate,
      endDate: timeOff.endDate,
      rrule: timeOff.rrule,
      timezone: timeOff.timezone,
      recurrenceEndDate: timeOff.recurrenceEndDate,
    })
    .from(timeOff)
    .where(
      and(
        eq(timeOff.organizationId, organizationId),
        inArray(timeOff.practitionerId, practitionerIds),
        eq(timeOff.approved, true),
        or(
          and(
            isNull(timeOff.rrule),
            lte(timeOff.startDate, to),
            gte(timeOff.endDate, from)
          ),
          and(
            isNotNull(timeOff.rrule),
            lte(timeOff.startDate, to),
            or(
              isNull(timeOff.recurrenceEndDate),
              gte(timeOff.recurrenceEndDate, from)
            )
          )
        )
      )
    );

  const busyByPractitioner = new Map<string, AvailabilityBusyRange[]>();
  const pushBusy = (practitionerId: string, range: AvailabilityBusyRange) => {
    const list = busyByPractitioner.get(practitionerId) ?? [];
    list.push(range);
    busyByPractitioner.set(practitionerId, list);
  };

  for (const row of timeOffRows) {
    for (const range of expandTimeOff(row, from, to)) {
      pushBusy(row.practitionerId, range);
    }
  }

  // ── Blocked time (org-wide + practitioner-scoped) ──────────────────────────
  const blockedBusyByPractitioner = await loadBlockedTime(
    db,
    organizationId,
    practitionerIds,
    from,
    to
  );
  for (const [practitionerId, ranges] of blockedBusyByPractitioner) {
    for (const range of ranges) pushBusy(practitionerId, range);
  }

  // ── Appointments (per practitioner) ────────────────────────────────────────
  const appointmentRows = await db
    .select({
      practitionerId: appointment.practitionerId,
      startDate: appointment.startDate,
      endDate: appointment.endDate,
    })
    .from(appointment)
    .where(
      and(
        eq(appointment.organizationId, organizationId),
        inArray(appointment.practitionerId, practitionerIds),
        inArray(appointment.status, [...activeAppointmentStatuses]),
        notDeleted(appointment),
        lt(appointment.startDate, to),
        gt(appointment.endDate, from)
      )
    );

  for (const row of appointmentRows) {
    if (!row.practitionerId) continue;
    pushBusy(row.practitionerId, { start: row.startDate, end: row.endDate });
  }

  // ── External busy (e.g. Google Calendar), supplied by caller ───────────────
  if (additionalBusyByPractitioner) {
    for (const [practitionerId, ranges] of Object.entries(
      additionalBusyByPractitioner
    )) {
      for (const range of ranges) pushBusy(practitionerId, range);
    }
  }

  return practitionerIds.map((practitionerId) => ({
    practitionerId,
    working: workingByPractitioner.get(practitionerId) ?? [],
    busy: busyByPractitioner.get(practitionerId) ?? [],
  }));
}

/**
 * Load blocked-time busy ranges keyed by practitioner. Org-wide blocks (zero
 * join rows) apply to every practitioner in `practitionerIds`. Mirrors
 * `listBlockedTime` but returns bare busy ranges per practitioner.
 */
async function loadBlockedTime(
  db: DbConnection,
  organizationId: string,
  practitionerIds: string[],
  from: Date,
  to: Date
): Promise<Map<string, AvailabilityBusyRange[]>> {
  const result = new Map<string, AvailabilityBusyRange[]>();

  // Explicit column list, NOT select(*) — see the time-off read above.
  // `blocked_time.title` / `.description` are free text ("Dr Ryan — hospital")
  // and are never needed to compute a busy interval, so `app_public` is not
  // granted them.
  const series = await db
    .select({
      id: blockedTime.id,
      startDate: blockedTime.startDate,
      endDate: blockedTime.endDate,
      rrule: blockedTime.rrule,
      timezone: blockedTime.timezone,
      recurrenceEndDate: blockedTime.recurrenceEndDate,
    })
    .from(blockedTime)
    .where(
      and(
        eq(blockedTime.organizationId, organizationId),
        or(
          and(
            isNull(blockedTime.rrule),
            lte(blockedTime.startDate, to),
            gte(blockedTime.endDate, from)
          ),
          and(
            isNotNull(blockedTime.rrule),
            lte(blockedTime.startDate, to),
            or(
              isNull(blockedTime.recurrenceEndDate),
              gte(blockedTime.recurrenceEndDate, from)
            )
          )
        )
      )
    );

  if (series.length === 0) return result;

  const seriesIds = series.map((s) => s.id);

  const joins: BlockedTimePractitioner[] = await db
    .select()
    .from(blockedTimePractitioner)
    .where(inArray(blockedTimePractitioner.blockedTimeId, seriesIds));

  const practitionersBySeries = new Map<string, string[]>();
  for (const join of joins) {
    const list = practitionersBySeries.get(join.blockedTimeId) ?? [];
    list.push(join.practitionerId);
    practitionersBySeries.set(join.blockedTimeId, list);
  }

  // Narrowed: app_public is not granted the exception's title/description
  // either — they mirror the parent block's staff-personal free text.
  const exceptions: (BlockedTimeBusyException & { blockedTimeId: string })[] =
    await db
      .select({
        blockedTimeId: blockedTimeException.blockedTimeId,
        originalStart: blockedTimeException.originalStart,
        startDate: blockedTimeException.startDate,
        endDate: blockedTimeException.endDate,
        cancelled: blockedTimeException.cancelled,
      })
      .from(blockedTimeException)
      .where(
        and(
          inArray(blockedTimeException.blockedTimeId, seriesIds),
          gte(blockedTimeException.originalStart, from),
          lte(blockedTimeException.originalStart, to)
        )
      );

  const exceptionsBySeries = new Map<string, BlockedTimeBusyException[]>();
  for (const exc of exceptions) {
    const list = exceptionsBySeries.get(exc.blockedTimeId) ?? [];
    list.push(exc);
    exceptionsBySeries.set(exc.blockedTimeId, list);
  }

  for (const s of series) {
    const targeted = practitionersBySeries.get(s.id) ?? [];
    // Zero join rows = org-wide: applies to every requested practitioner.
    const appliesTo = targeted.length > 0 ? targeted : practitionerIds;
    const occurrences = expandBlockedTimeBusy(
      s,
      exceptionsBySeries.get(s.id) ?? [],
      from,
      to
    );
    for (const occ of occurrences) {
      for (const practitionerId of appliesTo) {
        if (!practitionerIds.includes(practitionerId)) continue;
        const list = result.get(practitionerId) ?? [];
        list.push({ start: occ.start, end: occ.end });
        result.set(practitionerId, list);
      }
    }
  }

  return result;
}

/**
 * Org-wide blocked-time busy ranges (blocks with zero practitioner joins).
 * Equivalent to the old `getUnavailabilityBusyRanges(practitionerId: null)` —
 * used by availability paths that have no practitioner context (e.g. an org's
 * primary external calendar). Expects to run inside an org scope.
 */
export async function resolveOrgWideBlockedBusy(
  db: DbConnection,
  organizationId: string,
  from: Date,
  to: Date
): Promise<AvailabilityBusyRange[]> {
  // Explicit column list, NOT select(*) — app_public is granted only these.
  const series = await db
    .select({
      id: blockedTime.id,
      startDate: blockedTime.startDate,
      endDate: blockedTime.endDate,
      rrule: blockedTime.rrule,
      timezone: blockedTime.timezone,
      recurrenceEndDate: blockedTime.recurrenceEndDate,
    })
    .from(blockedTime)
    .where(
      and(
        eq(blockedTime.organizationId, organizationId),
        or(
          and(
            isNull(blockedTime.rrule),
            lte(blockedTime.startDate, to),
            gte(blockedTime.endDate, from)
          ),
          and(
            isNotNull(blockedTime.rrule),
            lte(blockedTime.startDate, to),
            or(
              isNull(blockedTime.recurrenceEndDate),
              gte(blockedTime.recurrenceEndDate, from)
            )
          )
        )
      )
    );

  if (series.length === 0) return [];

  const seriesIds = series.map((s) => s.id);
  const joins: BlockedTimePractitioner[] = await db
    .select()
    .from(blockedTimePractitioner)
    .where(inArray(blockedTimePractitioner.blockedTimeId, seriesIds));
  const targetedSeriesIds = new Set(joins.map((j) => j.blockedTimeId));

  // Narrowed: app_public is not granted the exception's title/description
  // either — they mirror the parent block's staff-personal free text.
  const exceptions: (BlockedTimeBusyException & { blockedTimeId: string })[] =
    await db
      .select({
        blockedTimeId: blockedTimeException.blockedTimeId,
        originalStart: blockedTimeException.originalStart,
        startDate: blockedTimeException.startDate,
        endDate: blockedTimeException.endDate,
        cancelled: blockedTimeException.cancelled,
      })
      .from(blockedTimeException)
      .where(
        and(
          inArray(blockedTimeException.blockedTimeId, seriesIds),
          gte(blockedTimeException.originalStart, from),
          lte(blockedTimeException.originalStart, to)
        )
      );
  const exceptionsBySeries = new Map<string, BlockedTimeBusyException[]>();
  for (const exc of exceptions) {
    const list = exceptionsBySeries.get(exc.blockedTimeId) ?? [];
    list.push(exc);
    exceptionsBySeries.set(exc.blockedTimeId, list);
  }

  const ranges: AvailabilityBusyRange[] = [];
  for (const s of series) {
    // Org-wide only: skip any block targeted at specific practitioners.
    if (targetedSeriesIds.has(s.id)) continue;
    for (const occ of expandBlockedTimeBusy(
      s,
      exceptionsBySeries.get(s.id) ?? [],
      from,
      to
    )) {
      ranges.push({ start: occ.start, end: occ.end });
    }
  }
  return ranges;
}

/**
 * Generate grid-aligned candidate slots from resolved working intervals,
 * dropping any that overlap a busy range or start in the past.
 *
 * Steps every `stepMinutes` from each working interval's start (preserving the
 * legacy grid alignment), emitting `[t, t+duration]` while it fits the interval.
 */
export function generateSlots(
  availability: ResolvedPractitionerAvailability,
  durationMinutes: number,
  options?: { stepMinutes?: number; now?: Date }
): AvailabilityBusyRange[] {
  const step = (options?.stepMinutes ?? 30) * 60 * 1000;
  const durationMs = durationMinutes * 60 * 1000;
  const now = options?.now ?? new Date();
  const slots: AvailabilityBusyRange[] = [];

  for (const interval of availability.working) {
    let t = interval.start.getTime();
    while (t + durationMs <= interval.end.getTime()) {
      const start = new Date(t);
      const end = new Date(t + durationMs);
      const overlapsBusy = availability.busy.some(
        (b) => start < b.end && end > b.start
      );
      if (!overlapsBusy && start > now) {
        slots.push({ start, end });
      }
      t += step;
    }
  }

  return slots;
}
