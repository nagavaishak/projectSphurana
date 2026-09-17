import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDate, resolveRelativeDate } from './resolve-relative-date.js';

describe('resolveRelativeDate', () => {
  beforeEach(() => {
    // Fix "today" to Wednesday 2026-03-11
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 11)); // March 11, 2026 (Wednesday)
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes through YYYY-MM-DD format unchanged', () => {
    expect(resolveRelativeDate('2026-06-15')).toBe('2026-06-15');
  });

  it('resolves "today" to current date', () => {
    expect(resolveRelativeDate('today')).toBe('2026-03-11');
  });

  it('resolves "Today" case-insensitively', () => {
    expect(resolveRelativeDate('Today')).toBe('2026-03-11');
  });

  it('resolves "tomorrow" to next day', () => {
    expect(resolveRelativeDate('tomorrow')).toBe('2026-03-12');
  });

  it('resolves "this week" to tomorrow', () => {
    expect(resolveRelativeDate('this week')).toBe('2026-03-12');
  });

  it('resolves "next available" to tomorrow', () => {
    expect(resolveRelativeDate('next available')).toBe('2026-03-12');
  });

  describe('day names', () => {
    // Wednesday March 11, 2026

    it('resolves "thursday" to next Thursday (1 day ahead)', () => {
      expect(resolveRelativeDate('thursday')).toBe('2026-03-12');
    });

    it('resolves "friday" to next Friday (2 days ahead)', () => {
      expect(resolveRelativeDate('friday')).toBe('2026-03-13');
    });

    it('resolves "monday" to next Monday (5 days ahead)', () => {
      expect(resolveRelativeDate('monday')).toBe('2026-03-16');
    });

    it('resolves "wednesday" to next week Wednesday (7 days ahead)', () => {
      // Same day of week → wraps to next week
      expect(resolveRelativeDate('wednesday')).toBe('2026-03-18');
    });

    it('resolves "sunday" to next Sunday (4 days ahead)', () => {
      expect(resolveRelativeDate('sunday')).toBe('2026-03-15');
    });

    it('handles uppercase day names', () => {
      expect(resolveRelativeDate('FRIDAY')).toBe('2026-03-13');
    });
  });

  it('falls back to tomorrow for unknown date strings', () => {
    expect(resolveRelativeDate('asap')).toBe('2026-03-12');
    expect(resolveRelativeDate('whenever')).toBe('2026-03-12');
  });
});

describe('formatDate', () => {
  it('formats a date as YYYY-MM-DD', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('zero-pads single-digit months and days', () => {
    expect(formatDate(new Date(2026, 2, 9))).toBe('2026-03-09');
  });

  it('handles December correctly', () => {
    expect(formatDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});
