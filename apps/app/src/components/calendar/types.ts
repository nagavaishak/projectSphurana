export type TCalendarView =
  | 'day'
  | '3day'
  | 'week'
  | 'month'
  | 'year'
  | 'agenda';
export type TEventColor =
  | 'blue'
  | 'green'
  | 'red'
  | 'yellow'
  | 'purple'
  | 'orange'
  | 'gray';
export type TBadgeVariant = 'dot' | 'colored' | 'mixed';
export type TWorkingHours = { [key: number]: { from: number; to: number } };
export type TVisibleHours = { from: number; to: number };

/** One working interval on a resolved shift day (minutes from midnight). */
export type TShiftInterval = { startMinutes: number; endMinutes: number };

/**
 * A practitioner's resolved shift for a single date (overrides applied).
 * Decoupled from the scheduling feature so the calendar library stays
 * independent; the appointments provider maps `ResolvedShiftDay` onto this.
 * Time outside these intervals is shaded with the diagonal off-shift hatch.
 */
export type TResolvedShift = {
  practitionerId: string;
  /** YYYY-MM-DD */
  date: string;
  isOff: boolean;
  intervals: TShiftInterval[];
};

// Calendar mode for different use cases
export type TCalendarMode = 'appointments' | 'content';
