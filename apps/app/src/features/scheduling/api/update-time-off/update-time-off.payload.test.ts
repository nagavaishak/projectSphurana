import { describe, expect, it } from 'vitest';

import {
  type UpdateTimeOffFormInput,
  buildUpdateTimeOffPayload,
} from './update-time-off.payload';

/**
 * Wire-body builder for PUT /time-off/:id. Shares the exact org-tz instant +
 * recurrence derivation as create; `id` travels in the route, not the body.
 */

const base: UpdateTimeOffFormInput = {
  id: 'to_1',
  practitionerId: 'prac_1',
  type: 'sick_leave',
  startDate: '2026-03-02',
  startTime: '09:00',
  endDate: '2026-03-02',
  endTime: '17:00',
  repeats: false,
  description: 'flu',
  approved: true,
  timeZone: 'Europe/Dublin',
};

describe('buildUpdateTimeOffPayload', () => {
  it('threads id in the route and resolves instants in the ORG zone', () => {
    const { id, body } = buildUpdateTimeOffPayload(base);
    expect(id).toBe('to_1');
    expect('id' in body).toBe(false);
    expect('practitionerId' in body).toBe(false);
    expect(body.timezone).toBe('Europe/Dublin');
    expect((body.startDate as Date).toISOString()).toBe(
      '2026-03-02T09:00:00.000Z'
    );
    expect(body.type).toBe('sick_leave');
    expect(body.approved).toBe(true);
  });
});
