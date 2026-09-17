import { z } from 'zod';

/**
 * Per-day-of-week opening hours.
 * Keys: 0=Sunday..6=Saturday. Values in minutes from midnight.
 * If a day is omitted (or from===to), the location is closed that day.
 */
export const openingHoursSchema = z.record(
  z.string().regex(/^[0-6]$/),
  z.object({
    from: z.number().int().min(0).max(1440),
    to: z.number().int().min(0).max(1440),
  })
);

export type OpeningHoursShape = z.infer<typeof openingHoursSchema>;

/**
 * Effective opening hours for a specific date — either inherited from the
 * standing weekly schedule or overridden by a per-date exception.
 */
export interface EffectiveOpeningHours {
  date: string; // YYYY-MM-DD
  closed: boolean;
  fromMinutes: number | null; // null if closed
  toMinutes: number | null;
  source: 'standing' | 'exception' | 'inherited-org' | 'default';
  exceptionId: string | null;
}
