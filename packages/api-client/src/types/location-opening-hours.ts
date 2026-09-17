/**
 * Per-day-of-week opening hours.
 * Keys: stringified day-of-week (0=Sunday..6=Saturday).
 * Values: { from, to } in minutes from midnight.
 * Day key omitted (or from===to) means closed that day.
 */
export type LocationOpeningHours = Record<string, { from: number; to: number }>;

export interface OpeningHoursException {
  id: string;
  locationId: string;
  date: string; // YYYY-MM-DD
  closed: boolean;
  fromMinutes: number | null;
  toMinutes: number | null;
  note: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocationScheduleResult {
  locationId: string;
  /** Standing weekly schedule, or null = inherit org businessHours. */
  openingHours: LocationOpeningHours | null;
  /** Fallback weekly schedule from the organization. */
  organizationDefault: LocationOpeningHours | null;
  /** Per-date overrides within the queried window. */
  exceptions: OpeningHoursException[];
}

export interface GetLocationScheduleParams {
  windowStart: string;
  windowEnd: string;
}

export interface UpdateStandingOpeningHoursInput {
  openingHours: LocationOpeningHours | null;
}

export interface UpsertOpeningHoursExceptionInput {
  closed: boolean;
  fromMinutes?: number | null;
  toMinutes?: number | null;
  note?: string | null;
}

/**
 * Scope for editing opening hours via the calendar:
 * - 'date' = override for just this day (creates/updates an exception)
 * - 'standing' = updates the location's standing weekly schedule
 */
export type OpeningHoursEditScope = 'date' | 'standing';
