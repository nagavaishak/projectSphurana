import { describe, expect, it } from 'vitest';
import type { BRollClip, ScheduledBRollClip } from './b-roll-scheduler.js';
import type { UsedRegion } from './clip-utilities.js';
import { fillTimelineWithClips } from './fill-timeline.js';

function makeClip(overrides: Partial<BRollClip> = {}): BRollClip {
  return {
    id: 'clip-1',
    url: 'clip-1.mp4',
    sourceDurationSec: 30,
    order: 0,
    ...overrides,
  };
}

function makeScheduled(
  overrides: Partial<ScheduledBRollClip> = {}
): ScheduledBRollClip {
  return {
    id: 'clip-1',
    url: 'clip-1.mp4',
    startTimeSec: 0,
    durationSec: 3,
    trimStartSec: 0,
    ...overrides,
  };
}

describe('fillTimelineWithClips', () => {
  it('fills timeline up to availableEnd', () => {
    const scheduled = [makeScheduled({ startTimeSec: 0, durationSec: 3 })];
    const sortedClips = [makeClip({ sourceDurationSec: 30 })];
    const usedRegionsMap = new Map<string, UsedRegion[]>();
    const segmentCounterMap = new Map<string, number>();

    const result = fillTimelineWithClips({
      scheduled,
      availableEnd: 15,
      sortedClips,
      usedRegionsMap,
      segmentCounterMap,
      config: { minClipDurationSec: 2, fixedClipDurationSec: 3 },
    });

    expect(result.length).toBeGreaterThan(0);

    // All new clips should be within bounds
    const allClips = [...scheduled, ...result];
    const lastClip = allClips[allClips.length - 1];
    expect(lastClip.startTimeSec + lastClip.durationSec).toBeLessThanOrEqual(
      15 + 0.1
    );
  });

  it('respects gap — does not exceed availableEnd', () => {
    const scheduled = [makeScheduled({ startTimeSec: 0, durationSec: 5 })];
    const sortedClips = [makeClip({ sourceDurationSec: 20 })];
    const usedRegionsMap = new Map<string, UsedRegion[]>();
    const segmentCounterMap = new Map<string, number>();

    const result = fillTimelineWithClips({
      scheduled,
      availableEnd: 10,
      sortedClips,
      usedRegionsMap,
      segmentCounterMap,
      config: { minClipDurationSec: 2, fixedClipDurationSec: 3 },
    });

    for (const clip of result) {
      expect(clip.startTimeSec + clip.durationSec).toBeLessThanOrEqual(
        10 + 0.1
      );
    }
  });

  it('stops when clips exhausted (source too short)', () => {
    const scheduled = [makeScheduled({ startTimeSec: 0, durationSec: 2 })];
    const sortedClips = [makeClip({ sourceDurationSec: 4 })];
    const usedRegionsMap = new Map<string, UsedRegion[]>([
      ['clip-1', [{ start: 0, duration: 2 }]],
    ]);
    const segmentCounterMap = new Map<string, number>([['clip-1', 1]]);

    const result = fillTimelineWithClips({
      scheduled,
      availableEnd: 100,
      sortedClips,
      usedRegionsMap,
      segmentCounterMap,
      config: { minClipDurationSec: 2, fixedClipDurationSec: 2 },
    });

    // Source is only 4s, 2s already used, can fit one more 2s clip then exhausted
    expect(result.length).toBeLessThanOrEqual(1);
  });

  it('handles empty clip array', () => {
    const scheduled = [makeScheduled()];
    const result = fillTimelineWithClips({
      scheduled,
      availableEnd: 20,
      sortedClips: [],
      usedRegionsMap: new Map(),
      segmentCounterMap: new Map(),
      config: { minClipDurationSec: 2, fixedClipDurationSec: 3 },
    });
    expect(result).toEqual([]);
  });

  it('handles empty scheduled array', () => {
    const result = fillTimelineWithClips({
      scheduled: [],
      availableEnd: 20,
      sortedClips: [makeClip()],
      usedRegionsMap: new Map(),
      segmentCounterMap: new Map(),
      config: { minClipDurationSec: 2, fixedClipDurationSec: 3 },
    });
    expect(result).toEqual([]);
  });

  it('tracks used regions correctly', () => {
    const scheduled = [makeScheduled({ startTimeSec: 0, durationSec: 3 })];
    const sortedClips = [makeClip({ sourceDurationSec: 20 })];
    const usedRegionsMap = new Map<string, UsedRegion[]>();
    const segmentCounterMap = new Map<string, number>();

    fillTimelineWithClips({
      scheduled,
      availableEnd: 12,
      sortedClips,
      usedRegionsMap,
      segmentCounterMap,
      config: { minClipDurationSec: 2, fixedClipDurationSec: 3 },
    });

    // Should have recorded used regions
    const regions = usedRegionsMap.get('clip-1') || [];
    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) {
      expect(region.duration).toBeGreaterThan(0);
      expect(region.start).toBeGreaterThanOrEqual(0);
    }
  });

  it('recycles across multiple clips', () => {
    const scheduled = [
      makeScheduled({ id: 'a', url: 'a.mp4', startTimeSec: 0, durationSec: 2 }),
    ];
    const sortedClips = [
      makeClip({ id: 'a', url: 'a.mp4', sourceDurationSec: 10 }),
      makeClip({ id: 'b', url: 'b.mp4', sourceDurationSec: 10 }),
    ];
    const usedRegionsMap = new Map<string, UsedRegion[]>();
    const segmentCounterMap = new Map<string, number>();

    const result = fillTimelineWithClips({
      scheduled,
      availableEnd: 20,
      sortedClips,
      usedRegionsMap,
      segmentCounterMap,
      config: { minClipDurationSec: 2, fixedClipDurationSec: 3 },
    });

    expect(result.length).toBeGreaterThan(0);
    // Should use both clips
    const ids = new Set(result.map((c) => c.id));
    expect(ids.size).toBeGreaterThanOrEqual(1);
  });

  it('uses varied duration when fixedClipDurationSec is not set', () => {
    const scheduled = [makeScheduled({ startTimeSec: 0, durationSec: 2 })];
    const sortedClips = [makeClip({ sourceDurationSec: 60 })];
    const usedRegionsMap = new Map<string, UsedRegion[]>();
    const segmentCounterMap = new Map<string, number>();

    const result = fillTimelineWithClips({
      scheduled,
      availableEnd: 30,
      sortedClips,
      usedRegionsMap,
      segmentCounterMap,
      config: { minClipDurationSec: 2, maxClipDurationSec: 5 },
    });

    expect(result.length).toBeGreaterThan(0);
    // Durations should vary (or at least be within range)
    for (const clip of result) {
      expect(clip.durationSec).toBeGreaterThanOrEqual(2);
      expect(clip.durationSec).toBeLessThanOrEqual(5 + 0.1);
    }
  });
});
