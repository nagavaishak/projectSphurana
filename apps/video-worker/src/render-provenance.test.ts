import { describe, expect, it } from 'vitest';
import { summariseRenderSchedule } from './render-provenance.js';

const scene = (id: string, startTimeSec: number, trimStartSec: number) => ({
  id,
  url: `https://cdn/${id}.mp4`,
  startTimeSec,
  durationSec: 2.6,
  trimStartSec,
});

const summarise = (scheduled: ReturnType<typeof scene>[]) =>
  summariseRenderSchedule({
    scheduler: 'fade-benefits',
    templateId: 'fade-benefits',
    variationId: 'fade-benefits-1',
    plannedClipIds: [...new Set(scheduled.map((s) => s.id))],
    scheduled,
  });

describe('summariseRenderSchedule', () => {
  it('counts scenes and distinct clips separately — that difference is the signal', () => {
    const out = summarise([
      scene('a', 0, 0),
      scene('a', 2.6, 4),
      scene('b', 5.2, 0),
    ]);
    expect(out.sceneCount).toBe(3);
    expect(out.distinctClipCount).toBe(2);
  });

  it('does NOT flag reuse when each scene shows different seconds', () => {
    // This is intentional: fewer clips than copy lines is structural, and
    // generateTrimStart deliberately picks a different segment each time.
    const out = summarise([scene('a', 0, 0), scene('a', 2.6, 6)]);
    expect(out.repeatsIdenticalFootage).toBe(false);
  });

  it('flags reuse when the SAME seconds play twice — the actual defect', () => {
    // The shipped shape: `trimStartSec: 0` hard-coded, so reuse replayed the
    // identical footage and read as a loop.
    const out = summarise([
      scene('a', 0, 0),
      scene('b', 2.6, 0),
      scene('a', 5.2, 0),
    ]);
    expect(out.repeatsIdenticalFootage).toBe(true);
  });

  it('is clean for an all-distinct schedule', () => {
    const out = summarise([
      scene('a', 0, 0),
      scene('b', 2.6, 0),
      scene('c', 5.2, 0),
    ]);
    expect(out.sceneCount).toBe(3);
    expect(out.distinctClipCount).toBe(3);
    expect(out.repeatsIdenticalFootage).toBe(false);
  });

  it('records the scheduler path so the producing branch is identifiable', () => {
    // Four schedulers behave differently; without this the only way to tell
    // which built a video was to read all of them.
    expect(summarise([scene('a', 0, 0)]).scheduler).toBe('fade-benefits');
    expect(summarise([scene('a', 0, 0)]).stage).toBe('render');
  });

  it('keeps the planned list so plan-vs-render drift is visible', () => {
    const out = summariseRenderSchedule({
      scheduler: 'beat-synced',
      plannedClipIds: ['a', 'b', 'c'],
      scheduled: [scene('a', 0, 0)],
    });
    expect(out.plannedClipIds).toEqual(['a', 'b', 'c']);
    expect(out.sceneCount).toBe(1);
  });

  it('handles an empty schedule', () => {
    const out = summariseRenderSchedule({
      scheduler: 'beat-synced',
      plannedClipIds: [],
      scheduled: [],
    });
    expect(out.sceneCount).toBe(0);
    expect(out.distinctClipCount).toBe(0);
    expect(out.repeatsIdenticalFootage).toBe(false);
  });
});
