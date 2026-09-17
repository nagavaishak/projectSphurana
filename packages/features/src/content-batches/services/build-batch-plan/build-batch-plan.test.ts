import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import type { Slot } from './build-batch-plan.schema.js';
import { buildBatchPlan } from './build-batch-plan.service.js';

const FIXED_START = new Date('2026-01-01T00:00:00.000Z');

const TEMPLATE_4 = ['t-a', 't-b', 't-c', 't-d'];
const SERVICE_2 = ['s-a', 's-b'];

const baseInput = {
  cadence: 6,
  periodDays: 14,
  startFromDate: FIXED_START,
  timeOfDayMinutes: 10 * 60,
  templateIds: TEMPLATE_4,
  serviceIds: SERVICE_2,
} as const;

const unwrap = (result: Awaited<ReturnType<typeof buildBatchPlan>>): Slot[] => {
  if (!result.success) {
    throw new Error(
      `expected success, got ${result.error.code}: ${result.error.message}`
    );
  }
  return result.data;
};

/** Compute the minimum gap between repeated values in an array, or Infinity if none repeat. */
const minRepeatGap = (values: string[]): number => {
  const lastSeen = new Map<string, number>();
  let min = Number.POSITIVE_INFINITY;
  values.forEach((value, index) => {
    const previous = lastSeen.get(value);
    if (previous !== undefined) {
      const gap = index - previous;
      if (gap < min) min = gap;
    }
    lastSeen.set(value, index);
  });
  return min;
};

describe('buildBatchPlan', () => {
  it('returns a slot per cadence count (default 6)', async () => {
    const result = await buildBatchPlan(baseInput);
    const slots = unwrap(result);
    expect(slots).toHaveLength(6);
  });

  it('uses each of 4 templates exactly once when cadence=4', async () => {
    const result = await buildBatchPlan({
      ...baseInput,
      cadence: 4,
      templateIds: TEMPLATE_4,
    });
    const slots = unwrap(result);
    const used = slots.map((s) => s.templateId);
    const counts = new Map<string, number>();
    for (const t of used) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const t of TEMPLATE_4) {
      expect(counts.get(t)).toBe(1);
    }
  });

  it('minimum gap between same-template slots is >= 4 when cadence=6 and 4 templates', async () => {
    const result = await buildBatchPlan({
      ...baseInput,
      cadence: 6,
      templateIds: TEMPLATE_4,
    });
    const slots = unwrap(result);
    const gap = minRepeatGap(slots.map((s) => s.templateId));
    expect(gap).toBeGreaterThanOrEqual(4);
  });

  it('services strictly alternate when cadence=6 and 2 services', async () => {
    const result = await buildBatchPlan({
      ...baseInput,
      cadence: 6,
      serviceIds: SERVICE_2,
    });
    const slots = unwrap(result);
    // Strict alternation: no two adjacent serviceIds are the same.
    for (let i = 1; i < slots.length; i += 1) {
      expect(slots[i].serviceId).not.toBe(slots[i - 1].serviceId);
    }
    // And there are only two distinct serviceIds in play.
    const distinct = new Set(slots.map((s) => s.serviceId));
    expect(distinct.size).toBe(2);
  });

  it('all scheduledAt are distinct calendar days within [start+1, start+periodDays]', async () => {
    const result = await buildBatchPlan({
      ...baseInput,
      cadence: 6,
      periodDays: 14,
    });
    const slots = unwrap(result);

    const startDayUtc = Date.UTC(
      FIXED_START.getUTCFullYear(),
      FIXED_START.getUTCMonth(),
      FIXED_START.getUTCDate()
    );
    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    const dayOffsets = slots.map((s) => {
      const _ms = s.scheduledAt.getTime();
      const slotDayUtc = Date.UTC(
        s.scheduledAt.getUTCFullYear(),
        s.scheduledAt.getUTCMonth(),
        s.scheduledAt.getUTCDate()
      );
      return Math.round((slotDayUtc - startDayUtc) / MS_PER_DAY);
    });

    // Distinct calendar days.
    expect(new Set(dayOffsets).size).toBe(dayOffsets.length);

    // Within [start+1, start+14].
    for (const offset of dayOffsets) {
      expect(offset).toBeGreaterThanOrEqual(1);
      expect(offset).toBeLessThanOrEqual(14);
    }

    // Specifically the 6/14 layout: days 1, 3, 6, 8, 11, 14.
    expect([...dayOffsets].sort((a, b) => a - b)).toEqual([1, 3, 6, 8, 11, 14]);
  });

  it('all slots carry the configured time-of-day (default 10:00 UTC)', async () => {
    const result = await buildBatchPlan(baseInput);
    const slots = unwrap(result);
    for (const slot of slots) {
      expect(slot.scheduledAt.getUTCHours()).toBe(10);
      expect(slot.scheduledAt.getUTCMinutes()).toBe(0);
      expect(slot.scheduledAt.getUTCSeconds()).toBe(0);
      expect(slot.scheduledAt.getUTCMilliseconds()).toBe(0);
    }
  });

  it('respects a custom timeOfDayMinutes', async () => {
    const result = await buildBatchPlan({
      ...baseInput,
      timeOfDayMinutes: 9 * 60 + 30, // 09:30 UTC
    });
    const slots = unwrap(result);
    for (const slot of slots) {
      expect(slot.scheduledAt.getUTCHours()).toBe(9);
      expect(slot.scheduledAt.getUTCMinutes()).toBe(30);
    }
  });

  it('is deterministic — same input produces identical output twice', async () => {
    const a = unwrap(await buildBatchPlan(baseInput));
    const b = unwrap(await buildBatchPlan(baseInput));
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i += 1) {
      expect(a[i].scheduledAt.getTime()).toBe(b[i].scheduledAt.getTime());
      expect(a[i].templateId).toBe(b[i].templateId);
      expect(a[i].variationId).toBe(b[i].variationId);
      expect(a[i].serviceId).toBe(b[i].serviceId);
    }
  });

  it('resolves variationId from each templateId (falls back to "<id>-1" for unknown templates)', async () => {
    const result = await buildBatchPlan({
      ...baseInput,
      cadence: 4,
      templateIds: TEMPLATE_4,
    });
    const slots = unwrap(result);
    for (const slot of slots) {
      expect(slot.variationId).toBe(`${slot.templateId}-1`);
    }
  });

  it('resolves variationId from real organic template variations', async () => {
    // Use an actual organic template id; first variation should be picked.
    const result = await buildBatchPlan({
      ...baseInput,
      cadence: 1,
      templateIds: ['caption-tease'],
      serviceIds: ['s-a'],
    });
    const slots = unwrap(result);
    expect(slots[0].variationId).toBe('caption-tease-1');
  });

  it('handles cadence=1 (single slot, day 1)', async () => {
    const result = await buildBatchPlan({
      ...baseInput,
      cadence: 1,
      templateIds: ['only-t'],
      serviceIds: ['only-s'],
    });
    const slots = unwrap(result);
    expect(slots).toHaveLength(1);
    expect(slots[0].templateId).toBe('only-t');
    expect(slots[0].serviceId).toBe('only-s');
    // Should land on day 1.
    const startDayUtc = Date.UTC(
      FIXED_START.getUTCFullYear(),
      FIXED_START.getUTCMonth(),
      FIXED_START.getUTCDate()
    );
    const slotDayUtc = Date.UTC(
      slots[0].scheduledAt.getUTCFullYear(),
      slots[0].scheduledAt.getUTCMonth(),
      slots[0].scheduledAt.getUTCDate()
    );
    expect((slotDayUtc - startDayUtc) / (24 * 60 * 60 * 1000)).toBe(1);
  });

  it('normalises startFromDate to UTC midnight (time-of-day comes from timeOfDayMinutes)', async () => {
    // startFromDate at 18:42 UTC — slot times should still be at 10:00 UTC,
    // and the day offset should be measured from that calendar day.
    const offDate = new Date('2026-01-01T18:42:13.500Z');
    const result = await buildBatchPlan({
      ...baseInput,
      startFromDate: offDate,
    });
    const slots = unwrap(result);
    for (const slot of slots) {
      expect(slot.scheduledAt.getUTCHours()).toBe(10);
      expect(slot.scheduledAt.getUTCMinutes()).toBe(0);
    }
    // First slot: 2026-01-01 + 1 day = 2026-01-02 at 10:00 UTC.
    expect(slots[0].scheduledAt.toISOString()).toBe('2026-01-02T10:00:00.000Z');
  });

  it('returns VALIDATION_ERROR when templateIds is empty', async () => {
    const result = await buildBatchPlan({
      ...baseInput,
      templateIds: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR when serviceIds is empty', async () => {
    const result = await buildBatchPlan({
      ...baseInput,
      serviceIds: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR when cadence < 1', async () => {
    const result = await buildBatchPlan({
      ...baseInput,
      cadence: 0,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR when cadence > periodDays', async () => {
    const result = await buildBatchPlan({
      ...baseInput,
      cadence: 15,
      periodDays: 14,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
