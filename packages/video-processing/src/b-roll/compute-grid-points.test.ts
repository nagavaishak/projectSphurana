import { describe, expect, it } from 'vitest';
import { computeGridPoints } from './compute-grid-points.js';

describe('computeGridPoints', () => {
  it('returns evenly spaced points', () => {
    const points = computeGridPoints(0, 10, 2);
    expect(points).toEqual([0, 2, 4, 6, 8]);
  });

  it('first point starts at availableStart', () => {
    const points = computeGridPoints(3, 15, 2);
    expect(points[0]).toBe(3);
  });

  it('last point does not exceed availableEnd', () => {
    const points = computeGridPoints(0, 10, 3);
    // Points: 0, 3, 6 — next would be 9 but 9+3=12 > 10
    expect(points).toEqual([0, 3, 6]);
    for (const p of points) {
      expect(p + 3).toBeLessThanOrEqual(10);
    }
  });

  it('handles zero-length range', () => {
    const points = computeGridPoints(5, 5, 2);
    expect(points).toEqual([]);
  });

  it('handles interval larger than range', () => {
    const points = computeGridPoints(0, 3, 5);
    expect(points).toEqual([]);
  });

  it('handles interval exactly fitting the range', () => {
    const points = computeGridPoints(0, 4, 2);
    expect(points).toEqual([0, 2]);
  });

  it('handles fractional intervals', () => {
    const points = computeGridPoints(0, 5, 1.5);
    // 0, 1.5, 3.0 — next would be 4.5 but 4.5+1.5=6 > 5
    expect(points).toEqual([0, 1.5, 3.0]);
  });

  it('handles non-zero start with fractional interval', () => {
    const points = computeGridPoints(2, 8, 2.5);
    // 2, 4.5 — next would be 7 but 7+2.5=9.5 > 8
    expect(points).toEqual([2, 4.5]);
  });
});
