import { describe, expect, it } from 'vitest';

import {
  dayKeyInTz,
  localDayKey,
  relativeDayLabel,
  shortDateTimeInTz,
  time12InTz,
  timeInTz,
} from './portal-time';

// 2026-03-09T22:30:00Z — 22:30 in Dublin (GMT), but 09:30 the NEXT day in
// Sydney. Any helper that quietly used the runner's local zone gets caught by
// the pair of assertions rather than by the value looking plausible.
const LATE_EVENING = '2026-03-09T22:30:00.000Z';

describe('timezone formatting', () => {
  it('formats the time in the clinic zone, not the browser zone', () => {
    expect(timeInTz(LATE_EVENING, 'Europe/Dublin')).toBe('22:30');
    expect(timeInTz(LATE_EVENING, 'Australia/Sydney')).toBe('09:30');
  });

  it('rolls the calendar day over in the clinic zone', () => {
    expect(dayKeyInTz(LATE_EVENING, 'Europe/Dublin')).toBe('2026-03-09');
    expect(dayKeyInTz(LATE_EVENING, 'Australia/Sydney')).toBe('2026-03-10');
  });

  it('respects daylight saving in the clinic zone', () => {
    // 2026-07-01 — Dublin is on IST (UTC+1), so 12:00Z reads as 13:00.
    expect(timeInTz('2026-07-01T12:00:00.000Z', 'Europe/Dublin')).toBe('13:00');
    expect(timeInTz('2026-01-01T12:00:00.000Z', 'Europe/Dublin')).toBe('12:00');
  });

  it('formats a 12-hour slot label', () => {
    expect(time12InTz('2026-03-09T14:30:00.000Z', 'Europe/Dublin')).toBe(
      '2:30 pm'
    );
  });

  it('formats a short date-time for deadlines', () => {
    expect(shortDateTimeInTz(LATE_EVENING, 'Europe/Dublin')).toBe(
      'Mon 9 Mar, 22:30'
    );
  });
});

describe('relativeDayLabel', () => {
  const dublin = 'Europe/Dublin';

  it('says Today for the same clinic-day', () => {
    expect(
      relativeDayLabel(
        '2026-03-09T09:00:00.000Z',
        dublin,
        new Date('2026-03-09T20:00:00.000Z')
      )
    ).toBe('Today');
  });

  it('says Tomorrow for the next clinic-day', () => {
    expect(
      relativeDayLabel(
        '2026-03-10T09:00:00.000Z',
        dublin,
        new Date('2026-03-09T20:00:00.000Z')
      )
    ).toBe('Tomorrow');
  });

  it('falls back to a dated label further out', () => {
    expect(
      relativeDayLabel(
        '2026-03-14T09:00:00.000Z',
        dublin,
        new Date('2026-03-09T20:00:00.000Z')
      )
    ).toBe('Sat 14 Mar 2026');
  });

  it('decides Today/Tomorrow in the CLINIC zone, not the viewer zone', () => {
    // 23:30 UTC on the 9th is already the 10th in Sydney. A Sydney clinic must
    // call a 10th-Sydney appointment "Today"; a Dublin clinic must not.
    const now = new Date('2026-03-09T23:30:00.000Z');
    const appointment = '2026-03-10T02:00:00.000Z';

    expect(relativeDayLabel(appointment, 'Australia/Sydney', now)).toBe(
      'Today'
    );
    expect(relativeDayLabel(appointment, 'Europe/Dublin', now)).toBe(
      'Tomorrow'
    );
  });
});

describe('localDayKey', () => {
  it('formats a picker Date without a zone shift', () => {
    expect(localDayKey(new Date(2026, 2, 9))).toBe('2026-03-09');
    expect(localDayKey(new Date(2026, 11, 1))).toBe('2026-12-01');
  });
});
