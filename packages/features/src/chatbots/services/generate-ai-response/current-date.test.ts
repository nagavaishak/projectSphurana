import { describe, expect, it } from '@borradh-workspace/testing';

import { buildCurrentDateLine } from './current-date.js';

describe('buildCurrentDateLine', () => {
  it('names the date and weekday in the org timezone', () => {
    const line = buildCurrentDateLine(
      'Europe/London',
      new Date('2026-08-27T12:00:00Z')
    );

    expect(line).toContain('Thursday');
    expect(line).toContain('27 August 2026');
  });

  it('uses the org timezone, not the server clock', () => {
    // 23:30 UTC on the 27th is already the 28th in Auckland. A prompt built
    // from the server's clock would tell a NZ clinic the wrong day.
    const utcEvening = new Date('2026-08-27T23:30:00Z');

    expect(buildCurrentDateLine('Pacific/Auckland', utcEvening)).toContain(
      '28 August 2026'
    );
    expect(buildCurrentDateLine('Europe/London', utcEvening)).toContain(
      '28 August 2026'
    );
    expect(buildCurrentDateLine('America/Los_Angeles', utcEvening)).toContain(
      '27 August 2026'
    );
  });

  it.each([
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace', '   '],
  ])(
    'falls back to UTC, never the host clock, when the zone is %s',
    (_label, zone) => {
      // The failure this guards: `Intl` reads a missing timeZone as "use the
      // host default", so a dropped org timezone would silently produce the
      // container's date — differing between prod, a preview box and a laptop.
      // Pinned to an instant where UTC and the host can disagree on the DAY.
      const lateUtc = new Date('2026-08-27T23:30:00Z');

      expect(
        buildCurrentDateLine(zone as unknown as string, lateUtc)
      ).toContain('27 August 2026');
    }
  );

  it('falls back to UTC instead of throwing on an unknown timezone', () => {
    // A bad zone must never take the whole reply down — a slightly-wrong date
    // beats no response at all.
    const line = buildCurrentDateLine(
      'Not/AZone',
      new Date('2026-08-27T12:00:00Z')
    );

    expect(line).toContain('27 August 2026');
  });

  it('states that a cutoff date is the start of availability', () => {
    // The exact regression: the model read "no availability until September
    // 2nd" as blanket unavailability and refused September 4th.
    const line = buildCurrentDateLine(
      'Europe/London',
      new Date('2026-08-27T12:00:00Z')
    );

    expect(line).toMatch(/START of availability/i);
    expect(line).toMatch(/ON or\s+AFTER/i);
  });
});
