import { describe, expect, it } from '@borradh-workspace/testing';
import { parseDuration } from './parse-duration.js';

describe('parseDuration', () => {
  it('parses seconds', () => {
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('1s')).toBe(1_000);
  });

  it('parses minutes', () => {
    expect(parseDuration('30m')).toBe(30 * 60 * 1000);
    expect(parseDuration('1m')).toBe(60_000);
  });

  it('parses hours', () => {
    expect(parseDuration('1h')).toBe(3_600_000);
    expect(parseDuration('24h')).toBe(24 * 3_600_000);
  });

  it('parses days', () => {
    expect(parseDuration('1d')).toBe(86_400_000);
    expect(parseDuration('2d')).toBe(2 * 86_400_000);
    expect(parseDuration('7d')).toBe(7 * 86_400_000);
  });

  it('returns 0 for invalid format', () => {
    expect(parseDuration('abc')).toBe(0);
    expect(parseDuration('')).toBe(0);
    expect(parseDuration('10')).toBe(0);
    expect(parseDuration('10x')).toBe(0);
  });

  it('returns 0 for floating point values', () => {
    expect(parseDuration('1.5h')).toBe(0);
  });

  it('returns 0 for negative values', () => {
    expect(parseDuration('-1h')).toBe(0);
  });

  it('handles large values', () => {
    expect(parseDuration('365d')).toBe(365 * 86_400_000);
  });

  it('returns 0 for missing unit', () => {
    expect(parseDuration('100')).toBe(0);
  });

  it('returns 0 for unit only', () => {
    expect(parseDuration('h')).toBe(0);
  });
});
