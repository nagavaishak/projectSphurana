import { describe, expect, it } from '@borradh-workspace/testing';
import {
  BATCH_COVERAGE_DAYS,
  defaultVideoSchedules,
} from './generate-monthly-batch.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Scheduling used to spread posts across the remainder of the CALENDAR MONTH,
 * which broke for the way batches are actually created: owners click generate
 * whenever, roughly weekly, not on the 1st.
 *
 * Two consequences, both fixed here:
 *   - a batch generated late in the month had almost no runway, so a dozen
 *     posts landed hours apart
 *   - accepted items become social posts that SURVIVE the next regenerate, so
 *     each new batch laid its spread over an already-part-full calendar
 */
describe('defaultVideoSchedules', () => {
  it('starts tomorrow, never today or in the past', () => {
    const [first] = defaultVideoSchedules(5);
    expect(first.getTime()).toBeGreaterThan(Date.now());
  });

  it('spreads across the coverage window regardless of the date', () => {
    // The old implementation would have crammed these into whatever was left
    // of the calendar month.
    const schedules = defaultVideoSchedules(12);

    expect(schedules).toHaveLength(12);
    const spanDays =
      (schedules[11].getTime() - schedules[0].getTime()) / DAY_MS;
    // Allows for rounding to whole slots at the ends of the window.
    expect(spanDays).toBeGreaterThan(BATCH_COVERAGE_DAYS - 3);
    expect(spanDays).toBeLessThanOrEqual(BATCH_COVERAGE_DAYS);
  });

  it('gives every slot its own day when the count fits the window', () => {
    const schedules = defaultVideoSchedules(12);
    const days = new Set(schedules.map(dayKey));
    expect(days.size).toBe(12);
  });

  it('avoids days that already carry a scheduled post', () => {
    const clear = defaultVideoSchedules(4);
    const taken = new Set([dayKey(clear[0]), dayKey(clear[1])]);

    const avoided = defaultVideoSchedules(4, taken);

    for (const slot of avoided) {
      expect(taken.has(dayKey(slot))).toBe(false);
    }
  });

  it('does not double-book within its own batch while shifting', () => {
    // Once slots start moving to dodge booked days they could collide with
    // each other; each claim has to be remembered.
    const clear = defaultVideoSchedules(6);
    const taken = new Set(clear.slice(0, 3).map(dayKey));

    const avoided = defaultVideoSchedules(6, taken);
    const days = avoided.map(dayKey);

    expect(new Set(days).size).toBe(days.length);
  });

  it('returns slots in chronological order after shifting', () => {
    const clear = defaultVideoSchedules(5);
    const taken = new Set([dayKey(clear[2])]);

    const avoided = defaultVideoSchedules(5, taken);

    const times = avoided.map((d) => d.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('returns a single slot for a count of one', () => {
    expect(defaultVideoSchedules(1)).toHaveLength(1);
  });

  it('returns nothing for a count of zero', () => {
    expect(defaultVideoSchedules(0)).toEqual([]);
  });
});
