import { describe, expect, it } from 'vitest';

import {
  BLOCKED_TIME_CUSTOM_TYPE,
  type BlockedTimeFormData,
  blockedTimeForm,
  buildCreateBlockedTimePayload,
} from './blocked-time-form';

/**
 * The recurrence branches the form contract cannot drive in ONE fill — the
 * "Ends" select renders either an end DATE or an occurrence COUNT, never both.
 * The contract (`blocked-time.contract.test.tsx`) proves both controls are
 * reachable and drives the UNTIL branch end-to-end; these pin the pure builder's
 * remaining branches.
 */
const TYPE = {
  id: 'bt-type-1',
  name: 'Lunch',
  durationMinutes: 45,
  paid: true,
};

describe('buildCreateBlockedTimePayload (shared core)', () => {
  const context = { types: [TYPE], timeZone: 'UTC' };

  const base: BlockedTimeFormData = {
    ...blockedTimeForm.defaults,
    typeId: BLOCKED_TIME_CUSTOM_TYPE,
    title: 'Block',
    date: '2026-03-02',
    startTime: '09:00',
    endTime: '10:00',
  };

  it('carries multiple practitioners (empty = whole team)', () => {
    expect(
      buildCreateBlockedTimePayload(base, context).practitionerIds
    ).toEqual([]);
    expect(
      buildCreateBlockedTimePayload(
        { ...base, practitionerIds: ['p1', 'p2'] },
        context
      ).practitionerIds
    ).toEqual(['p1', 'p2']);
  });

  it('emits an RRULE with an UNTIL when the series ends on a date', () => {
    const payload = buildCreateBlockedTimePayload(
      { ...base, frequency: 'weekly', ends: 'on', endsOnDate: '2026-04-02' },
      context
    );
    expect(payload.rrule).toContain('FREQ=WEEKLY');
    expect(payload.rrule).toContain('UNTIL=');
    expect(payload.recurrenceEndDate).not.toBeNull();
  });

  it('emits an RRULE with a COUNT when the series ends after N occurrences', () => {
    const payload = buildCreateBlockedTimePayload(
      { ...base, frequency: 'daily', ends: 'after', endsAfterCount: 5 },
      context
    );
    expect(payload.rrule).toContain('FREQ=DAILY');
    expect(payload.rrule).toContain('COUNT=5');
  });

  it('omits `paid` for a custom (preset-less) block', () => {
    expect('paid' in buildCreateBlockedTimePayload(base, context)).toBe(false);
  });

  it('carries the preset `paid` flag and its type id', () => {
    const payload = buildCreateBlockedTimePayload(
      { ...base, typeId: TYPE.id },
      context
    );
    expect(payload.blockedTimeTypeId).toBe(TYPE.id);
    expect(payload.paid).toBe(true);
  });
});
