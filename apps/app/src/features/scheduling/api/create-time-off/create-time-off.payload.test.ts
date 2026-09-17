import { describe, expect, it } from 'vitest';

import {
  type CreateTimeOffFormInput,
  buildCreateTimeOffPayload,
} from './create-time-off.payload';

/**
 * Wire-body builder for POST /time-off. The audit fix: wall-clock times must
 * resolve in the ORG timezone and the `timezone` field must carry the org zone,
 * NOT the device's (`Intl…resolvedOptions().timeZone`). Blocked time was already
 * fixed this way; time off now matches.
 */

const base: CreateTimeOffFormInput = {
  practitionerId: 'prac_1',
  type: 'annual_leave',
  startDate: '2026-03-02',
  startTime: '09:00',
  endDate: '2026-03-02',
  endTime: '17:00',
  repeats: false,
  description: '  ',
  approved: true,
  timeZone: 'Europe/Dublin',
};

describe('buildCreateTimeOffPayload', () => {
  it('resolves instants + timezone in the ORG zone (not the device)', () => {
    const body = buildCreateTimeOffPayload(base);
    expect(body.timezone).toBe('Europe/Dublin');
    // 09:00 wall-clock in Dublin on 2 Mar 2026 (pre-DST, UTC+0).
    expect((body.startDate as Date).toISOString()).toBe(
      '2026-03-02T09:00:00.000Z'
    );
    expect((body.endDate as Date).toISOString()).toBe(
      '2026-03-02T17:00:00.000Z'
    );
  });

  it('trims a blank description to null and omits recurrence when not repeating', () => {
    const body = buildCreateTimeOffPayload(base);
    expect(body.description).toBeNull();
    expect(body.rrule).toBeNull();
    expect(body.recurrenceEndDate).toBeNull();
    expect(body.allDay).toBe(false);
  });

  it('emits a weekly RRULE with an UNTIL when repeating', () => {
    const body = buildCreateTimeOffPayload({
      ...base,
      repeats: true,
      repeatUntil: '2026-04-06',
    });
    expect(body.rrule).toContain('FREQ=WEEKLY');
    expect(body.rrule).toContain('UNTIL=');
    expect(body.recurrenceEndDate).not.toBeNull();
  });
});
