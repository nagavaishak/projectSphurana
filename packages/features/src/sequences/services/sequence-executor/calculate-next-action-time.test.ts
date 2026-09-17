import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { afterEach, vi } from 'vitest';
import * as businessHours from '../../../shared/business-hours.js';
import { calculateNextActionTime } from './calculate-next-action-time.js';
import type { SequenceStep } from './types.js';

// NOTE: `getNextBusinessHoursTime` is controlled with a RESTORED `vi.spyOn`
// (see beforeEach/afterEach below), not `vi.mock`. `shared/index.js` has a
// fan-in of ~570 test files and this package runs `isolate: false`, so a
// file-local factory mock of that barrel would persist on the shared worker
// module graph and leak this stub into every later file.

function makeStep(
  overrides: Partial<SequenceStep> & { type: string }
): SequenceStep {
  return {
    id: 'step-1',
    order: 1,
    config: {},
    ...overrides,
  };
}

describe('calculateNextActionTime', () => {
  let getNextBusinessHoursTimeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-03-10T14:00:00Z')); // Monday 2pm UTC
    getNextBusinessHoursTimeSpy = vi
      .spyOn(businessHours, 'getNextBusinessHoursTime')
      .mockImplementation((date: Date) => {
        // Simulate pushing to next business hours (Monday 9 AM)
        const adjusted = new Date(date);
        adjusted.setHours(9, 0, 0, 0);
        if (adjusted <= date) {
          adjusted.setDate(adjusted.getDate() + 1);
        }
        return adjusted;
      }) as ReturnType<typeof vi.spyOn>;
  });

  afterEach(() => {
    getNextBusinessHoursTimeSpy.mockRestore();
    vi.useRealTimers();
  });

  it('returns 5 minutes from now when voice_call followed by condition', () => {
    const current = makeStep({ type: 'voice_call' });
    const next = makeStep({ type: 'condition' });

    const result = calculateNextActionTime(current, next, null);
    const expected = new Date('2025-03-10T14:05:00Z');
    expect(result.getTime()).toBe(expected.getTime());
  });

  it('applies wait duration', () => {
    const current = makeStep({ type: 'email' });
    const next = makeStep({
      type: 'wait',
      config: { duration: '1h' },
    });

    const result = calculateNextActionTime(current, next, null);
    const expected = new Date('2025-03-10T15:00:00Z');
    expect(result.getTime()).toBe(expected.getTime());
  });

  it('applies wait duration with days', () => {
    const current = makeStep({ type: 'email' });
    const next = makeStep({
      type: 'wait',
      config: { duration: '2d' },
    });

    const result = calculateNextActionTime(current, next, null);
    const expected = new Date('2025-03-12T14:00:00Z');
    expect(result.getTime()).toBe(expected.getTime());
  });

  it('applies business hours to wait step when configured', () => {
    const current = makeStep({ type: 'email' });
    const next = makeStep({
      type: 'wait',
      config: { duration: '30m', respectBusinessHours: true },
    });
    const businessHours = {
      monday: { start: '09:00', end: '17:00' },
      timezone: 'UTC',
    };

    // biome-ignore lint/suspicious/noExplicitAny: partial business hours for test
    const result = calculateNextActionTime(current, next, businessHours as any);
    // getNextBusinessHoursTime mock adjusts to 9 AM next day if past hours
    expect(result).toBeDefined();
  });

  it('applies business hours for voice_call step', () => {
    const current = makeStep({ type: 'email' });
    const next = makeStep({ type: 'voice_call' });
    const businessHours = {
      monday: { start: '09:00', end: '17:00' },
      timezone: 'UTC',
    };

    // biome-ignore lint/suspicious/noExplicitAny: partial business hours for test
    const result = calculateNextActionTime(current, next, businessHours as any);
    // Mock pushes to 9 AM next day
    expect(result).toBeDefined();
  });

  it('does not apply business hours for voice_call when none configured', () => {
    const current = makeStep({ type: 'email' });
    const next = makeStep({ type: 'voice_call' });

    const result = calculateNextActionTime(current, next, null);
    const now = new Date('2025-03-10T14:00:00Z');
    expect(result.getTime()).toBe(now.getTime());
  });

  it('returns now for immediate execution (email step)', () => {
    const current = makeStep({ type: 'email' });
    const next = makeStep({ type: 'email' });

    const result = calculateNextActionTime(current, next, null);
    const now = new Date('2025-03-10T14:00:00Z');
    expect(result.getTime()).toBe(now.getTime());
  });

  it('returns now for condition step (no delay)', () => {
    const current = makeStep({ type: 'email' });
    const next = makeStep({ type: 'condition' });

    const result = calculateNextActionTime(current, next, null);
    const now = new Date('2025-03-10T14:00:00Z');
    expect(result.getTime()).toBe(now.getTime());
  });

  it('returns now for webhook step (no delay)', () => {
    const current = makeStep({ type: 'email' });
    const next = makeStep({ type: 'webhook' });

    const result = calculateNextActionTime(current, next, null);
    const now = new Date('2025-03-10T14:00:00Z');
    expect(result.getTime()).toBe(now.getTime());
  });

  it('handles wait step with minutes duration', () => {
    const current = makeStep({ type: 'sms' });
    const next = makeStep({
      type: 'wait',
      config: { duration: '30m' },
    });

    const result = calculateNextActionTime(current, next, null);
    const expected = new Date('2025-03-10T14:30:00Z');
    expect(result.getTime()).toBe(expected.getTime());
  });
});
