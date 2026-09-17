import { describe, expect, it } from '@borradh-workspace/testing';
import { validForToDate, validForToStripeInterval } from './valid-for.js';

describe('validForToDate', () => {
  const from = new Date('2026-01-15T10:00:00Z');

  it('adds days for day-based durations', () => {
    expect(validForToDate(from, '7d').toISOString()).toBe(
      '2026-01-22T10:00:00.000Z'
    );
    expect(validForToDate(from, '14d').toISOString()).toBe(
      '2026-01-29T10:00:00.000Z'
    );
  });

  it('adds months for month-based durations', () => {
    const oneMonth = validForToDate(from, '1m');
    expect([oneMonth.getFullYear(), oneMonth.getMonth()]).toEqual([2026, 1]);

    // Calendar-component assertions: month arithmetic is local-time based, so
    // ISO strings shift by an hour across DST boundaries.
    const eighteenMonths = validForToDate(from, '18m');
    expect([
      eighteenMonths.getFullYear(),
      eighteenMonths.getMonth(),
      eighteenMonths.getDate(),
    ]).toEqual([2027, 6, 15]);
  });

  it('adds years for year-based durations', () => {
    expect(validForToDate(from, '1y').toISOString()).toBe(
      '2027-01-15T10:00:00.000Z'
    );
    expect(validForToDate(from, '5y').toISOString()).toBe(
      '2031-01-15T10:00:00.000Z'
    );
  });

  it('does not mutate the input date', () => {
    const input = new Date('2026-01-15T10:00:00Z');
    validForToDate(input, '1m');
    expect(input.toISOString()).toBe('2026-01-15T10:00:00.000Z');
  });
});

describe('validForToStripeInterval', () => {
  it('maps whole-week day durations to weeks', () => {
    expect(validForToStripeInterval('7d')).toEqual({
      interval: 'week',
      intervalCount: 1,
    });
    expect(validForToStripeInterval('14d')).toEqual({
      interval: 'week',
      intervalCount: 2,
    });
  });

  it('maps month and year durations directly', () => {
    expect(validForToStripeInterval('1m')).toEqual({
      interval: 'month',
      intervalCount: 1,
    });
    expect(validForToStripeInterval('18m')).toEqual({
      interval: 'month',
      intervalCount: 18,
    });
    expect(validForToStripeInterval('2y')).toEqual({
      interval: 'year',
      intervalCount: 2,
    });
  });
});
