import { describe, expect, it } from 'vitest';
import { spreadSlots } from './spread-slots.js';

/** A clinic open 10:00-19:00 at 30-minute granularity: 18 slots. */
const day = Array.from({ length: 18 }, (_, i) => {
  const hour = 10 + Math.floor(i / 2);
  const minute = i % 2 === 0 ? '00' : '30';
  return `${hour.toString().padStart(2, '0')}:${minute}`;
});

describe('spreadSlots', () => {
  it('reaches the end of the day, which slice(0, n) never did', () => {
    const picked = spreadSlots(day, 5);
    expect(picked).toHaveLength(5);
    expect(picked[0]).toBe('10:00');
    expect(picked.at(-1)).toBe('18:30');
    // The old behaviour: 10:00, 10:30, 11:00, 11:30, 12:00 — a clinic open
    // until 19:00 reading as one that shuts at noon (ENG-814).
    expect(picked).not.toEqual(day.slice(0, 5));
  });

  it('covers morning, afternoon and evening', () => {
    const picked = spreadSlots(day, 3);
    expect(picked).toEqual(['10:00', '14:30', '18:30']);
  });

  it('never repeats a slot', () => {
    for (const limit of [2, 3, 5, 7, 17]) {
      const picked = spreadSlots(day, limit);
      expect(new Set(picked).size).toBe(picked.length);
      expect(picked).toHaveLength(limit);
    }
  });

  it('keeps chronological order', () => {
    const picked = spreadSlots(day, 6);
    expect([...picked].sort()).toEqual(picked);
  });

  it('returns everything when the day fits under the limit', () => {
    expect(spreadSlots(day, 18)).toEqual(day);
    expect(spreadSlots(day, 50)).toEqual(day);
  });

  it('handles the degenerate limits', () => {
    expect(spreadSlots(day, 1)).toEqual(['10:00']);
    expect(spreadSlots(day, 0)).toEqual([]);
    expect(spreadSlots(day, -1)).toEqual([]);
    expect(spreadSlots([], 3)).toEqual([]);
  });
});
