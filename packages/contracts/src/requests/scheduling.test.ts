import { describe, expect, it } from 'vitest';
import {
  createBlockedTimeRequestSchema,
  createBlockedTimeTypeRequestSchema,
  createTimeOffRequestSchema,
  setShiftOverrideRequestSchema,
  setWeeklyShiftsRequestSchema,
  updateBlockedTimeRequestSchema,
  updateBlockedTimeTypeRequestSchema,
  updateTimeOffRequestSchema,
  updateWageConfigRequestSchema,
} from './scheduling.js';

/**
 * Every suite below asserts the same three properties the request contracts
 * exist to guarantee — a valid body parses, an UNKNOWN key is rejected
 * (`.strict()`), and a missing required field is rejected — plus whatever
 * cross-field invariant that particular body carries.
 */

// --------------------------------------------------------------- blocked time

/** A valid `POST /blocked-time` body as the frontend sends it. */
const blockedTimeBody = {
  title: 'Team offsite',
  startDate: '2026-03-05T10:00:00.000Z',
  endDate: '2026-03-05T11:30:00.000Z',
};

describe('createBlockedTimeRequestSchema', () => {
  it('accepts a minimal valid body', () => {
    expect(
      createBlockedTimeRequestSchema.safeParse(blockedTimeBody).success
    ).toBe(true);
  });

  it('MATERIALISES the defaults into the parsed body', () => {
    const parsed = createBlockedTimeRequestSchema.parse(blockedTimeBody);
    // A client that omitted these now sends them — the whole reason a default
    // must not be quietly removed from the contract.
    expect(parsed.allDay).toBe(false);
    expect(parsed.timezone).toBe('UTC');
    expect(parsed.practitionerIds).toEqual([]);
  });

  it('coerces ISO strings AND accepts Date objects (z.coerce.date)', () => {
    const fromIso = createBlockedTimeRequestSchema.parse(blockedTimeBody);
    expect(fromIso.startDate).toBeInstanceOf(Date);

    const fromDates = createBlockedTimeRequestSchema.parse({
      ...blockedTimeBody,
      startDate: new Date(blockedTimeBody.startDate),
      endDate: new Date(blockedTimeBody.endDate),
    });
    expect(fromDates.startDate.toISOString()).toBe(blockedTimeBody.startDate);
  });

  it('REJECTS an unknown / server-injected field (proves .strict())', () => {
    const result = createBlockedTimeRequestSchema.safeParse({
      ...blockedTimeBody,
      organizationId: 'org_1',
    });
    expect(result.success).toBe(false);
  });

  it('REJECTS a body missing the required title', () => {
    const { title: _title, ...rest } = blockedTimeBody;
    expect(createBlockedTimeRequestSchema.safeParse(rest).success).toBe(false);
  });

  it('REJECTS endDate <= startDate', () => {
    const result = createBlockedTimeRequestSchema.safeParse({
      ...blockedTimeBody,
      endDate: blockedTimeBody.startDate,
    });
    expect(result.success).toBe(false);
  });
});

describe('updateBlockedTimeRequestSchema', () => {
  it('accepts an empty patch', () => {
    expect(updateBlockedTimeRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts originalStart (the RECURRENCE-ID of the edited occurrence)', () => {
    const result = updateBlockedTimeRequestSchema.safeParse({
      originalStart: '2026-03-05T10:00:00.000Z',
      title: 'Renamed',
    });
    expect(result.success).toBe(true);
  });

  it('REJECTS `scope` in the BODY — it travels as a query param', () => {
    const result = updateBlockedTimeRequestSchema.safeParse({
      title: 'Renamed',
      scope: 'this',
    });
    expect(result.success).toBe(false);
  });

  it('allows a one-ended patch but REJECTS an inverted pair', () => {
    expect(
      updateBlockedTimeRequestSchema.safeParse({
        startDate: '2026-03-05T10:00:00.000Z',
      }).success
    ).toBe(true);
    expect(
      updateBlockedTimeRequestSchema.safeParse({
        startDate: '2026-03-05T11:00:00.000Z',
        endDate: '2026-03-05T10:00:00.000Z',
      }).success
    ).toBe(false);
  });
});

// ---------------------------------------------------------- blocked-time types

describe('createBlockedTimeTypeRequestSchema', () => {
  const body = { name: 'Lunch', durationMinutes: 45 };

  it('accepts a valid body and defaults `paid` to false', () => {
    const parsed = createBlockedTimeTypeRequestSchema.parse(body);
    expect(parsed.paid).toBe(false);
  });

  it('REJECTS a duration off the 5-minute grid', () => {
    expect(
      createBlockedTimeTypeRequestSchema.safeParse({
        ...body,
        durationMinutes: 47,
      }).success
    ).toBe(false);
  });

  it('REJECTS an unknown field and a missing name', () => {
    expect(
      createBlockedTimeTypeRequestSchema.safeParse({ ...body, id: 'x' }).success
    ).toBe(false);
    expect(
      createBlockedTimeTypeRequestSchema.safeParse({ durationMinutes: 45 })
        .success
    ).toBe(false);
  });
});

describe('updateBlockedTimeTypeRequestSchema', () => {
  it('accepts a partial patch but REJECTS the route-param id', () => {
    expect(
      updateBlockedTimeTypeRequestSchema.safeParse({ paid: true }).success
    ).toBe(true);
    expect(
      updateBlockedTimeTypeRequestSchema.safeParse({ id: 'bt_1', paid: true })
        .success
    ).toBe(false);
  });
});

// ------------------------------------------------------------------- time off

const timeOffBody = {
  practitionerId: 'prac_1',
  startDate: '2026-03-05T09:00:00.000Z',
  endDate: '2026-03-06T17:00:00.000Z',
};

describe('createTimeOffRequestSchema', () => {
  it('accepts a minimal valid body and materialises its four defaults', () => {
    const parsed = createTimeOffRequestSchema.parse(timeOffBody);
    expect(parsed.type).toBe('annual_leave');
    expect(parsed.allDay).toBe(true);
    expect(parsed.timezone).toBe('UTC');
    expect(parsed.approved).toBe(true);
  });

  it('keeps practitionerId in the BODY (no practitioner route param)', () => {
    const { practitionerId: _p, ...rest } = timeOffBody;
    expect(createTimeOffRequestSchema.safeParse(rest).success).toBe(false);
  });

  it('REJECTS an unknown field and an inverted date pair', () => {
    expect(
      createTimeOffRequestSchema.safeParse({
        ...timeOffBody,
        createdById: 'user_1',
      }).success
    ).toBe(false);
    expect(
      createTimeOffRequestSchema.safeParse({
        ...timeOffBody,
        endDate: timeOffBody.startDate,
      }).success
    ).toBe(false);
  });
});

describe('updateTimeOffRequestSchema', () => {
  it('accepts a partial patch', () => {
    expect(
      updateTimeOffRequestSchema.safeParse({ approved: false }).success
    ).toBe(true);
  });

  it('REJECTS practitionerId — time off is not reassigned', () => {
    expect(
      updateTimeOffRequestSchema.safeParse({ practitionerId: 'prac_2' }).success
    ).toBe(false);
  });
});

// --------------------------------------------------------------------- shifts

describe('setWeeklyShiftsRequestSchema', () => {
  const body = {
    days: [
      {
        dayOfWeek: 1,
        intervals: [{ startMinutes: 540, endMinutes: 720 }],
      },
    ],
  };

  it('accepts a valid weekly pattern', () => {
    expect(setWeeklyShiftsRequestSchema.safeParse(body).success).toBe(true);
  });

  it('REJECTS overlapping intervals within a day', () => {
    const result = setWeeklyShiftsRequestSchema.safeParse({
      days: [
        {
          dayOfWeek: 1,
          intervals: [
            { startMinutes: 540, endMinutes: 720 },
            { startMinutes: 700, endMinutes: 900 },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('REJECTS duplicate dayOfWeek entries', () => {
    const result = setWeeklyShiftsRequestSchema.safeParse({
      days: [
        { dayOfWeek: 1, intervals: [] },
        { dayOfWeek: 1, intervals: [] },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('REJECTS the route-param practitionerId and a missing `days`', () => {
    expect(
      setWeeklyShiftsRequestSchema.safeParse({
        ...body,
        practitionerId: 'prac_1',
      }).success
    ).toBe(false);
    expect(setWeeklyShiftsRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('setShiftOverrideRequestSchema', () => {
  it('accepts a working-day override', () => {
    const parsed = setShiftOverrideRequestSchema.parse({
      date: '2026-03-05',
      intervals: [{ startMinutes: 540, endMinutes: 1020 }],
    });
    expect(parsed.isOff).toBe(false);
  });

  it('accepts a day off with no intervals', () => {
    const parsed = setShiftOverrideRequestSchema.parse({
      date: '2026-03-05',
      isOff: true,
    });
    expect(parsed.intervals).toEqual([]);
  });

  it('REJECTS a day off that also carries intervals', () => {
    const result = setShiftOverrideRequestSchema.safeParse({
      date: '2026-03-05',
      isOff: true,
      intervals: [{ startMinutes: 540, endMinutes: 1020 }],
    });
    expect(result.success).toBe(false);
  });

  it('REJECTS a working day with no intervals', () => {
    expect(
      setShiftOverrideRequestSchema.safeParse({ date: '2026-03-05' }).success
    ).toBe(false);
  });

  it('REJECTS a non-YYYY-MM-DD date and an unknown field', () => {
    expect(
      setShiftOverrideRequestSchema.safeParse({
        date: '2026-03-05T00:00:00.000Z',
        isOff: true,
      }).success
    ).toBe(false);
    expect(
      setShiftOverrideRequestSchema.safeParse({
        date: '2026-03-05',
        isOff: true,
        organizationId: 'org_1',
      }).success
    ).toBe(false);
  });
});

// ---------------------------------------------------------------- wage config

describe('updateWageConfigRequestSchema', () => {
  it('accepts an empty patch and a full one', () => {
    expect(updateWageConfigRequestSchema.safeParse({}).success).toBe(true);
    expect(
      updateWageConfigRequestSchema.safeParse({
        compensationType: 'hourly',
        hourlyRateCents: 1500,
        overtimeEnabled: true,
        regularWorkHours: 40,
        regularWorkHoursPer: 'week',
        overtimeType: 'multiplier',
        overtimeMultiplier: 1.5,
        autoClockIn: 'disabled',
      }).success
    ).toBe(true);
  });

  it('distinguishes null (CLEAR) from omitted (LEAVE ALONE)', () => {
    const cleared = updateWageConfigRequestSchema.parse({
      hourlyRateCents: null,
    });
    expect(cleared.hourlyRateCents).toBeNull();
    expect('hourlyRateCents' in updateWageConfigRequestSchema.parse({})).toBe(
      false
    );
  });

  it('REJECTS fractional cents and the route-param practitionerId', () => {
    expect(
      updateWageConfigRequestSchema.safeParse({ hourlyRateCents: 15.5 }).success
    ).toBe(false);
    expect(
      updateWageConfigRequestSchema.safeParse({ practitionerId: 'prac_1' })
        .success
    ).toBe(false);
  });
});
