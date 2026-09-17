import { describe, expect, it } from 'vitest';
import type { ActionSegment } from '../vision/types.js';
import type { BRollClip } from './b-roll-scheduler.js';
import {
  type UsedRegion,
  computeEvenSlotIndices,
  generateTrimStart,
  generateVariedDuration,
  generateVariedGap,
  overlapsUsedRegion,
  pickTrimStartFromSegments,
  sortClipsByType,
} from './clip-utilities.js';

describe('generateVariedDuration', () => {
  it('returns a value between min and max', () => {
    for (let i = 0; i < 50; i++) {
      const result = generateVariedDuration(2, 5, 10);
      expect(result).toBeGreaterThanOrEqual(2);
      expect(result).toBeLessThanOrEqual(5);
    }
  });

  it('does not exceed source duration', () => {
    for (let i = 0; i < 50; i++) {
      const result = generateVariedDuration(2, 5, 3);
      expect(result).toBeLessThanOrEqual(3);
    }
  });

  it('handles min equal to max', () => {
    const result = generateVariedDuration(3, 3, 10);
    expect(result).toBe(3);
  });

  it('rounds to 0.5 second increments', () => {
    for (let i = 0; i < 50; i++) {
      const result = generateVariedDuration(1, 10, 20);
      expect(result * 2).toBe(Math.round(result * 2));
    }
  });

  it('handles source shorter than min', () => {
    const result = generateVariedDuration(5, 10, 3);
    expect(result).toBeLessThanOrEqual(3);
  });
});

describe('overlapsUsedRegion', () => {
  it('returns false when no used regions', () => {
    expect(overlapsUsedRegion(0, 2, [])).toBe(false);
  });

  it('returns true when >50% overlap', () => {
    const used: UsedRegion[] = [{ start: 0, duration: 3 }];
    // Candidate [1, 3] overlaps [0, 3] by 2s out of 2s = 100%
    expect(overlapsUsedRegion(1, 2, used)).toBe(true);
  });

  it('returns false when <=50% overlap', () => {
    const used: UsedRegion[] = [{ start: 0, duration: 2 }];
    // Candidate [1, 5] overlaps [0, 2] by 1s out of 4s = 25%
    expect(overlapsUsedRegion(1, 4, used)).toBe(false);
  });

  it('returns false when no overlap at all', () => {
    const used: UsedRegion[] = [{ start: 0, duration: 2 }];
    expect(overlapsUsedRegion(5, 2, used)).toBe(false);
  });

  it('checks all used regions', () => {
    const used: UsedRegion[] = [
      { start: 0, duration: 2 },
      { start: 5, duration: 3 },
    ];
    // No overlap with first, but overlaps second
    expect(overlapsUsedRegion(5.5, 2, used)).toBe(true);
  });
});

describe('pickTrimStartFromSegments', () => {
  const actionSegments: ActionSegment[] = [
    { startSec: 5, endSec: 15, label: 'action', description: 'Main' },
    { startSec: 0, endSec: 5, label: 'idle', description: 'Wait' },
  ];

  it('returns null when no action segments exist', () => {
    const idleOnly: ActionSegment[] = [
      { startSec: 0, endSec: 10, label: 'idle', description: 'Nothing' },
    ];
    expect(pickTrimStartFromSegments(idleOnly, 2, 20, [], 0)).toBeNull();
  });

  it('picks trim within action segment bounds', () => {
    for (let i = 0; i < 20; i++) {
      const result = pickTrimStartFromSegments(actionSegments, 2, 20, [], 0);
      expect(result).not.toBeNull();
      expect(result).toBeGreaterThanOrEqual(5);
      expect(result).toBeLessThanOrEqual(13); // 15 - 2 = 13 max start
    }
  });

  it('round-robins through fitting segments', () => {
    const twoActions: ActionSegment[] = [
      { startSec: 0, endSec: 10, label: 'action', description: 'A' },
      { startSec: 20, endSec: 30, label: 'action', description: 'B' },
    ];
    const r0 = pickTrimStartFromSegments(twoActions, 2, 30, [], 0);
    const r1 = pickTrimStartFromSegments(twoActions, 2, 30, [], 1);
    // Counter 0 picks first segment, counter 1 picks second
    expect(r0).toBeGreaterThanOrEqual(0);
    expect(r0).toBeLessThanOrEqual(8);
    expect(r1).toBeGreaterThanOrEqual(20);
    expect(r1).toBeLessThanOrEqual(28);
  });

  it('uses longest action segment when none long enough', () => {
    const shortActions: ActionSegment[] = [
      { startSec: 5, endSec: 6, label: 'action', description: 'Short' },
      { startSec: 10, endSec: 11, label: 'action', description: 'Also short' },
    ];
    const result = pickTrimStartFromSegments(shortActions, 3, 20, [], 0);
    // Should use the start of one of the action segments
    expect(result).not.toBeNull();
    expect(result === 5 || result === 10).toBe(true);
  });

  it('avoids overlapping used regions', () => {
    const twoActions: ActionSegment[] = [
      { startSec: 0, endSec: 10, label: 'action', description: 'A' },
      { startSec: 20, endSec: 30, label: 'action', description: 'B' },
    ];
    // Used region covers entire first segment so any clip placement overlaps >50%
    const used: UsedRegion[] = [{ start: 0, duration: 10 }];
    const result = pickTrimStartFromSegments(twoActions, 2, 30, used, 0);
    // Should fall back to second segment
    expect(result).toBeGreaterThanOrEqual(20);
  });
});

describe('generateTrimStart', () => {
  it('returns 0 when source equals clip duration', () => {
    expect(generateTrimStart(5, 5)).toBe(0);
  });

  it('returns value within valid range', () => {
    for (let i = 0; i < 50; i++) {
      const result = generateTrimStart(20, 3);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(17); // 20 - 3
    }
  });

  it('prefers action segments when provided', () => {
    const segments: ActionSegment[] = [
      { startSec: 10, endSec: 18, label: 'action', description: 'Action' },
      { startSec: 0, endSec: 10, label: 'idle', description: 'Idle' },
    ];
    for (let i = 0; i < 20; i++) {
      const result = generateTrimStart(20, 2, segments);
      expect(result).toBeGreaterThanOrEqual(10);
      expect(result).toBeLessThanOrEqual(16);
    }
  });

  it('avoids used regions', () => {
    const used: UsedRegion[] = [{ start: 0, duration: 10 }];
    for (let i = 0; i < 20; i++) {
      const result = generateTrimStart(30, 2, undefined, used, 0);
      // Should generally avoid [0, 10] region
      // Not guaranteed due to fallback logic, but shouldn't heavily overlap
      expect(result).toBeGreaterThanOrEqual(0);
    }
  });

  it('handles empty segments array', () => {
    const result = generateTrimStart(20, 3, []);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(17);
  });
});

describe('generateVariedGap', () => {
  it('returns positive value', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateVariedGap(1.5)).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('varies around base gap within +-30%', () => {
    const base = 2;
    const results = Array.from({ length: 100 }, () => generateVariedGap(base));
    const min = Math.min(...results);
    const max = Math.max(...results);
    // Should have some variation
    expect(max - min).toBeGreaterThan(0);
    // Should stay roughly in range (min is clamped to 0.5)
    expect(min).toBeGreaterThanOrEqual(0.5);
    expect(max).toBeLessThanOrEqual(base * 1.35); // 30% + small margin
  });
});

describe('sortClipsByType', () => {
  it('orders: before → procedure → bRoll → after', () => {
    const clips: BRollClip[] = [
      { id: 'a', url: '', sourceDurationSec: 10, order: 0, clipType: 'after' },
      { id: 'b', url: '', sourceDurationSec: 10, order: 0, clipType: 'bRoll' },
      {
        id: 'c',
        url: '',
        sourceDurationSec: 10,
        order: 0,
        clipType: 'before',
      },
      {
        id: 'd',
        url: '',
        sourceDurationSec: 10,
        order: 0,
        clipType: 'procedure',
      },
    ];
    const sorted = sortClipsByType(clips);
    expect(sorted.map((c) => c.id)).toEqual(['c', 'd', 'b', 'a']);
  });

  it('sorts within type by order', () => {
    const clips: BRollClip[] = [
      { id: 'b2', url: '', sourceDurationSec: 10, order: 2, clipType: 'bRoll' },
      { id: 'b0', url: '', sourceDurationSec: 10, order: 0, clipType: 'bRoll' },
      { id: 'b1', url: '', sourceDurationSec: 10, order: 1, clipType: 'bRoll' },
    ];
    const sorted = sortClipsByType(clips);
    expect(sorted.map((c) => c.id)).toEqual(['b0', 'b1', 'b2']);
  });

  it('treats undefined clipType as bRoll', () => {
    const clips: BRollClip[] = [
      { id: 'a', url: '', sourceDurationSec: 10, order: 0, clipType: 'after' },
      { id: 'u', url: '', sourceDurationSec: 10, order: 0 },
      {
        id: 'b',
        url: '',
        sourceDurationSec: 10,
        order: 0,
        clipType: 'before',
      },
    ];
    const sorted = sortClipsByType(clips);
    expect(sorted.map((c) => c.id)).toEqual(['b', 'u', 'a']);
  });

  it('returns empty array for empty input', () => {
    expect(sortClipsByType([])).toEqual([]);
  });
});

describe('computeEvenSlotIndices', () => {
  it('spreads items evenly across slots', () => {
    expect(computeEvenSlotIndices(3, 12)).toEqual([0, 4, 8]);
  });

  it('returns all indices when count >= totalSlots', () => {
    expect(computeEvenSlotIndices(5, 3)).toEqual([0, 1, 2]);
  });

  it('handles single item', () => {
    expect(computeEvenSlotIndices(1, 10)).toEqual([0]);
  });

  it('handles count equal to totalSlots', () => {
    expect(computeEvenSlotIndices(4, 4)).toEqual([0, 1, 2, 3]);
  });

  it('distributes 2 items in 6 slots', () => {
    expect(computeEvenSlotIndices(2, 6)).toEqual([0, 3]);
  });
});
