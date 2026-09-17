import { describe, expect, it } from 'vitest';

import { buildUpdateBlockedTimeTypePayload } from './update-blocked-time-type.payload';

/** Wire-body builder for PUT /blocked-time-types/:id: `id` in route, `paid` → bool. */
describe('buildUpdateBlockedTimeTypePayload', () => {
  it('threads id in the route and coerces the paid radio', () => {
    const { id, body } = buildUpdateBlockedTimeTypePayload({
      id: 'btt_1',
      name: 'Team training',
      durationMinutes: 90,
      paid: 'paid',
    });
    expect(id).toBe('btt_1');
    expect('id' in body).toBe(false);
    expect(body).toEqual({
      name: 'Team training',
      durationMinutes: 90,
      paid: true,
    });
  });
});
