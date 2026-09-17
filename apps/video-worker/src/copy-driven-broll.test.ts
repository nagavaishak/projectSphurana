import { describe, expect, it } from 'vitest';
import { scheduleCopyDrivenBRoll } from './copy-driven-broll.js';

const clip = (id: string, sourceDurationSec = 12) => ({
  id,
  url: `https://cdn/${id}.mp4`,
  sourceDurationSec,
  order: 0,
});

const slots = (n: number, dur = 2.6) =>
  Array.from({ length: n }, (_, i) => ({
    startTimeSec: i * dur,
    durationSec: dur,
  }));

describe('scheduleCopyDrivenBRoll', () => {
  it('fills every slot — scene count is set by the copy and must not shrink', () => {
    // ImprovesLayer et al. map text 1:1 onto scenes, so dropping a scene drops
    // a line of copy.
    expect(
      scheduleCopyDrivenBRoll([clip('a'), clip('b')], slots(5))
    ).toHaveLength(5);
  });

  it('never re-introduces an earlier clip — the shipped botox defect', () => {
    // `i % length` gave 0,1,2,0: the opening shot returned as the closing shot.
    const out = scheduleCopyDrivenBRoll(
      [clip('a'), clip('b'), clip('c')],
      slots(4)
    );
    expect(out.map((c) => c.id)).toEqual(['a', 'a', 'b', 'c']);
  });

  it('is monotonic for every clips/slots ratio', () => {
    for (let clips = 1; clips <= 6; clips++) {
      for (let n = 1; n <= 12; n++) {
        const out = scheduleCopyDrivenBRoll(
          Array.from({ length: clips }, (_, i) => clip(`c${i}`)),
          slots(n)
        );
        const idx = out.map((c) => Number(c.id.slice(1)));
        expect(idx).toEqual([...idx].sort((x, y) => x - y));
      }
    }
  });

  it('gives a reused clip a DIFFERENT trim so it is not a replay', () => {
    // The old code hard-coded trimStartSec: 0, so reuse showed the same
    // seconds — which is what made it read as a loop rather than as more of
    // the treatment.
    const out = scheduleCopyDrivenBRoll([clip('a', 30)], slots(3));
    const trims = out.map((c) => c.trimStartSec);
    expect(new Set(trims).size).toBeGreaterThan(1);
  });

  it('keeps the slot timings it was given', () => {
    const given = slots(3, 4);
    const out = scheduleCopyDrivenBRoll([clip('a'), clip('b')], given);
    expect(out.map((c) => c.startTimeSec)).toEqual([0, 4, 8]);
    expect(out.map((c) => c.durationSec)).toEqual([4, 4, 4]);
  });

  it('uses every clip when counts match, in order', () => {
    const out = scheduleCopyDrivenBRoll(
      [clip('a'), clip('b'), clip('c')],
      slots(3)
    );
    expect(out.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns nothing for no clips or no slots', () => {
    expect(scheduleCopyDrivenBRoll([], slots(3))).toEqual([]);
    expect(scheduleCopyDrivenBRoll([clip('a')], [])).toEqual([]);
  });
});
