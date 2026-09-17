import { describe, expect, it } from 'vitest';

import { buildCreateBlockedTimeTypePayload } from './create-blocked-time-type.payload';

/** Wire-body builder for POST /blocked-time-types: `paid` radio → boolean. */
describe('buildCreateBlockedTimeTypePayload', () => {
  it('coerces the paid radio to a boolean', () => {
    expect(
      buildCreateBlockedTimeTypePayload({
        name: 'Lunch',
        durationMinutes: 60,
        paid: 'paid',
      })
    ).toEqual({ name: 'Lunch', durationMinutes: 60, paid: true });

    expect(
      buildCreateBlockedTimeTypePayload({
        name: 'Lunch',
        durationMinutes: 60,
        paid: 'unpaid',
      }).paid
    ).toBe(false);
  });
});
