import type {
  BlockedTime,
  BlockedTimeException,
} from '@borradh-workspace/database';
import {
  zonedDateString,
  zonedHourMinute,
  zonedWallTimeToUtc,
} from '../../shared/index.js';
import type { BlockedTimeWithPractitioners } from '../models/scheduling.types.js';

/**
 * Expand a single blocked-time series into occurrences within a window.
 * Handles both one-off and recurring (RRULE) blocked time. Port of
 * `expandUnavailability` (practitioner-unavailability), retargeted at the
 * blocked_time tables (contract §1.1.2/§3.2).
 */
export function expandBlockedTime(
  series: BlockedTime,
  practitionerIds: string[],
  exceptions: BlockedTimeException[],
  windowStart: Date,
  windowEnd: Date
): BlockedTimeWithPractitioners[] {
  const results: BlockedTimeWithPractitioners[] = [];
  const duration = series.endDate.getTime() - series.startDate.getTime();

  const exceptionMap = new Map(
    exceptions.map((e) => [e.originalStart.toISOString(), e])
  );

  if (!series.rrule) {
    // Single occurrence
    if (series.startDate <= windowEnd && series.endDate >= windowStart) {
      const exc = exceptionMap.get(series.startDate.toISOString());
      if (!exc?.cancelled) {
        results.push({
          ...series,
          startDate: exc?.startDate ?? series.startDate,
          endDate: exc?.endDate ?? series.endDate,
          title: exc?.title ?? series.title,
          description: exc?.description ?? series.description,
          rrule: null,
          practitionerIds,
          blockedTimeId: series.id,
          originalStart: series.startDate,
        });
      }
    }
    return results;
  }

  // Recurring: expand occurrences using basic RRULE parsing
  const occurrences = generateOccurrences(series, windowStart, windowEnd);

  for (const occStart of occurrences) {
    const occEnd = new Date(occStart.getTime() + duration);
    const exc = exceptionMap.get(occStart.toISOString());

    if (exc?.cancelled) continue;

    results.push({
      ...series,
      id: `${series.id}:${occStart.toISOString()}`,
      startDate: exc?.startDate ?? occStart,
      endDate: exc?.endDate ?? occEnd,
      title: exc?.title ?? series.title,
      description: exc?.description ?? series.description,
      practitionerIds,
      blockedTimeId: series.id,
      originalStart: occStart,
    });
  }

  return results;
}

/** The only blocked-time fields needed to compute a busy interval. */
export type BlockedTimeBusySeries = Pick<
  BlockedTime,
  'id' | 'startDate' | 'endDate' | 'rrule' | 'timezone'
>;

/** The only exception fields needed to compute a busy interval. */
export type BlockedTimeBusyException = Pick<
  BlockedTimeException,
  'originalStart' | 'startDate' | 'endDate' | 'cancelled'
>;

export interface BlockedTimeBusyRange {
  start: Date;
  end: Date;
}

/**
 * Expand a blocked-time series into bare busy ranges — the availability path's
 * counterpart to `expandBlockedTime`.
 *
 * Why a second function rather than a generic: `expandBlockedTime` returns whole
 * rows (it carries `title`/`description` through for the staff-facing listing),
 * so it structurally requires those columns. The availability resolver runs as
 * `app_public` for the unauthenticated booking widget and is deliberately NOT
 * granted them — `blocked_time.title` ("Dr Ryan — hospital appointment") is
 * staff personal data, and a busy interval never needs it. Same recurrence and
 * exception semantics, minus everything the public role must not read.
 */
export function expandBlockedTimeBusy(
  series: BlockedTimeBusySeries,
  exceptions: BlockedTimeBusyException[],
  windowStart: Date,
  windowEnd: Date
): BlockedTimeBusyRange[] {
  const results: BlockedTimeBusyRange[] = [];
  const duration = series.endDate.getTime() - series.startDate.getTime();
  const exceptionMap = new Map(
    exceptions.map((e) => [e.originalStart.toISOString(), e])
  );

  if (!series.rrule) {
    if (series.startDate <= windowEnd && series.endDate >= windowStart) {
      const exc = exceptionMap.get(series.startDate.toISOString());
      if (!exc?.cancelled) {
        results.push({
          start: exc?.startDate ?? series.startDate,
          end: exc?.endDate ?? series.endDate,
        });
      }
    }
    return results;
  }

  for (const occStart of expandRecurrence(
    series.rrule,
    series.startDate,
    series.timezone ?? 'UTC',
    windowStart,
    windowEnd
  )) {
    const exc = exceptionMap.get(occStart.toISOString());
    if (exc?.cancelled) continue;
    results.push({
      start: exc?.startDate ?? occStart,
      end: exc?.endDate ?? new Date(occStart.getTime() + duration),
    });
  }

  return results;
}

/**
 * Simple RRULE occurrence generator (subset: FREQ=DAILY/WEEKLY/MONTHLY/YEARLY,
 * INTERVAL, BYDAY, BYMONTHDAY, UNTIL, COUNT).
 *
 * Occurrences are expanded in the series' stored IANA time zone so that the
 * wall-clock time-of-day (and local weekday / day-of-month) is preserved across
 * DST transitions, and `INTERVAL`/`COUNT` are honoured relative to the series
 * start (not the query window).
 */
function generateOccurrences(
  series: BlockedTime,
  windowStart: Date,
  windowEnd: Date
): Date[] {
  return expandRecurrence(
    series.rrule,
    series.startDate,
    series.timezone ?? 'UTC',
    windowStart,
    windowEnd
  );
}

/**
 * Shared RRULE expansion used by blocked-time and time-off expanders.
 * `INTERVAL` is counted in whole periods (days/weeks/months/years) from the
 * series start; `COUNT` limits total occurrences from the series start (so a
 * later query window still emits the correct subset).
 */
export function expandRecurrence(
  rrule: string | null,
  seriesStart: Date,
  timeZone: string,
  windowStart: Date,
  windowEnd: Date
): Date[] {
  if (!rrule) return [];

  const params = parseRRule(rrule);
  const freq = params.FREQ ?? 'DAILY';
  const interval = Math.max(1, Number(params.INTERVAL ?? 1));
  const until = params.UNTIL ? parseUntil(params.UNTIL) : null;
  const count = params.COUNT ? Number(params.COUNT) : null;
  const byDay = params.BYDAY ? params.BYDAY.split(',') : null;
  const byMonthDay = params.BYMONTHDAY ? Number(params.BYMONTHDAY) : null;

  // Wall-clock date + minutes-of-day of the series start in its time zone.
  const startDateStr = zonedDateString(seriesStart, timeZone);
  const { hour, minute } = zonedHourMinute(seriesStart, timeZone);
  const startMinutes = hour * 60 + minute;
  const [startY, startM, startD] = startDateStr.split('-').map(Number);

  // Sub-minute remainder so the first occurrence is exactly `seriesStart`
  // (and every occurrence keeps the same wall-clock offset across DST).
  const baseUtcMs = zonedWallTimeToUtc(
    startDateStr,
    startMinutes,
    timeZone
  ).getTime();
  const subMinuteRemainderMs = seriesStart.getTime() - baseUtcMs;

  const results: Date[] = [];
  let emitted = 0; // occurrences counted from the series start (for COUNT)
  let iterations = 0;

  let cy = startY;
  let cm = startM;
  let cd = startD;

  while (true) {
    iterations++;
    if (iterations > 100000) break; // safety
    if (count !== null && emitted >= count) break;

    const dateStr = `${cy}-${pad2(cm)}-${pad2(cd)}`;
    const occMs =
      zonedWallTimeToUtc(dateStr, startMinutes, timeZone).getTime() +
      subMinuteRemainderMs;
    const occ = new Date(occMs);

    if (until && occ > until) break;
    if (occ > windowEnd) break;

    if (
      matchesRecurrence(
        cy,
        cm,
        cd,
        startY,
        startM,
        startD,
        freq,
        interval,
        byDay,
        byMonthDay
      )
    ) {
      if (occ >= windowStart) results.push(occ);
      emitted++;
    }

    [cy, cm, cd] = nextWallDay(cy, cm, cd);
  }

  return results;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Advance a wall-clock calendar date by one day. */
function nextWallDay(
  y: number,
  m: number,
  d: number
): [number, number, number] {
  const t = Date.UTC(y, m - 1, d) + 86400000;
  const dt = new Date(t);
  return [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
}

/** Integer day index for a calendar date (time-zone independent). */
function dayNumber(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** Weekday of a calendar date (0=Sun .. 6=Sat), time-zone independent. */
function weekdayOf(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const WEEKDAY_NAMES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function byDayMatchesWeekday(byDay: string[], weekday: number): boolean {
  const dayName = WEEKDAY_NAMES[weekday];
  return byDay.some((d) => d.replace(/[-\d]/g, '') === dayName);
}

function parseRRule(rrule: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of rrule.split(';')) {
    const [key, value] = part.split('=');
    if (key && value !== undefined) result[key] = value;
  }
  return result;
}

function parseUntil(until: string): Date {
  // Format: YYYYMMDDTHHMMSSZ or YYYYMMDD
  if (until.includes('T')) {
    return new Date(
      `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}T${until.slice(9, 11)}:${until.slice(11, 13)}:${until.slice(13, 15)}Z`
    );
  }
  return new Date(
    `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}T00:00:00Z`
  );
}

/**
 * Whether a candidate wall-clock calendar date is a valid occurrence, honouring
 * FREQ, INTERVAL (counted in whole periods from the series start), and
 * BYDAY/BYMONTHDAY filters.
 */
function matchesRecurrence(
  candY: number,
  candM: number,
  candD: number,
  startY: number,
  startM: number,
  startD: number,
  freq: string,
  interval: number,
  byDay: string[] | null,
  byMonthDay: number | null
): boolean {
  const weekday = weekdayOf(candY, candM, candD);

  if (freq === 'DAILY') {
    const daysSince =
      dayNumber(candY, candM, candD) - dayNumber(startY, startM, startD);
    if (daysSince % interval !== 0) return false;
    if (byDay) return byDayMatchesWeekday(byDay, weekday);
    return true;
  }

  if (freq === 'WEEKLY') {
    // Week buckets anchored at the Monday (WKST default) on/before the start.
    const startAnchor = mondayAnchor(dayNumber(startY, startM, startD));
    const weekIdx = Math.floor(
      (dayNumber(candY, candM, candD) - startAnchor) / 7
    );
    if (weekIdx % interval !== 0) return false;
    if (byDay) return byDayMatchesWeekday(byDay, weekday);
    return weekday === weekdayOf(startY, startM, startD);
  }

  if (freq === 'MONTHLY') {
    const monthsSince = (candY - startY) * 12 + (candM - startM);
    if (monthsSince % interval !== 0) return false;
    if (byMonthDay !== null) return candD === byMonthDay;
    if (byDay && byDay.length > 0) {
      // e.g. "2MO" = second Monday
      const match = byDay[0].match(/^(-?\d)(SU|MO|TU|WE|TH|FR|SA)$/);
      if (match) {
        const nth = Number(match[1]);
        const dayIdx = WEEKDAY_NAMES.indexOf(match[2]);
        return weekday === dayIdx && Math.ceil(candD / 7) === nth;
      }
    }
    return candD === startD;
  }

  if (freq === 'YEARLY') {
    const yearsSince = candY - startY;
    if (yearsSince % interval !== 0) return false;
    return candM === startM && candD === startD;
  }

  return false;
}

/** Day index of the Monday on/before the given day index (WKST=MO). */
function mondayAnchor(dayNum: number): number {
  const weekday = new Date(dayNum * 86400000).getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (weekday + 6) % 7;
  return dayNum - daysSinceMonday;
}

/**
 * Replace/append UNTIL (and strip COUNT) in an RRULE body so the series ends
 * at `until`. Used by scope='following' edits and deletes.
 */
export function truncateRRule(rrule: string, until: Date): string {
  const isoCompact = `${until.getUTCFullYear()}${String(
    until.getUTCMonth() + 1
  ).padStart(2, '0')}${String(until.getUTCDate()).padStart(2, '0')}T${String(
    until.getUTCHours()
  ).padStart(2, '0')}${String(until.getUTCMinutes()).padStart(2, '0')}${String(
    until.getUTCSeconds()
  ).padStart(2, '0')}Z`;

  return rrule
    .split(';')
    .filter((part) => part.length > 0)
    .filter((part) => !part.toUpperCase().startsWith('UNTIL='))
    .filter((part) => !part.toUpperCase().startsWith('COUNT='))
    .concat([`UNTIL=${isoCompact}`])
    .join(';');
}
