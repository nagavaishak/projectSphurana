import type { BlockedTime, Shift } from '@borradh-workspace/database';

/**
 * Edit scope for recurring blocked time (contract §3.2):
 * - 'this' = create/update an exception for this one occurrence only
 * - 'following' = truncate the series before this occurrence, then create a
 *   new series starting at this occurrence with the new values
 * - 'all' = update the underlying series directly
 *
 * For non-recurring (rrule=null) series only 'all' is meaningful; the
 * services treat other values as 'all'.
 */
export const blockedTimeEditScopeValues = ['this', 'following', 'all'] as const;
export type BlockedTimeEditScope = (typeof blockedTimeEditScopeValues)[number];

/**
 * A blocked time with the practitioners it applies to.
 * `practitionerIds` empty = org-wide block (applies to all practitioners).
 *
 * When returned from `listBlockedTime`, rows are expanded occurrences:
 * `startDate`/`endDate` are the occurrence dates, `blockedTimeId` points at
 * the series, and `originalStart` identifies the occurrence (RECURRENCE-ID)
 * for scope='this'/'following' edits. For recurring occurrences `id` is
 * `${seriesId}:${originalStart.toISOString()}`.
 */
export interface BlockedTimeWithPractitioners extends BlockedTime {
  practitionerIds: string[];
  /** The parent series id (equals `id` for non-expanded rows). */
  blockedTimeId?: string;
  /** Original occurrence start (RECURRENCE-ID) for expanded occurrences. */
  originalStart?: Date;
}

/** One resolved working interval on a resolved shift day. */
export interface ResolvedShiftInterval {
  shiftId: string;
  startMinutes: number;
  endMinutes: number;
  locationId: string | null;
}

/**
 * The resolved schedule for one practitioner on one date, with date
 * overrides applied over the weekly pattern (contract §1.1.6).
 */
export interface ResolvedShiftDay {
  practitionerId: string;
  /** YYYY-MM-DD */
  date: string;
  /** 0=Sunday..6=Saturday */
  dayOfWeek: number;
  isOff: boolean;
  source: 'weekly' | 'override';
  intervals: ResolvedShiftInterval[];
}

/** Raw shift rows split by kind (weekly pattern vs date override). */
export interface ShiftRowsByKind {
  weekly: Shift[];
  overrides: Shift[];
}
