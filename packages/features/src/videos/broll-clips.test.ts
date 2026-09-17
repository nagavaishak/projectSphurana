import { describe, expect, it } from '@borradh-workspace/testing';
import { dedupeBRollClips } from './broll-clips.js';

const clip = (assetId: string, order: number) =>
  ({ assetId, order, clipType: 'bRoll' }) as const;

describe('dedupeBRollClips', () => {
  it('leaves an already-distinct list untouched', () => {
    const clips = [clip('a', 0), clip('b', 1), clip('c', 2)];
    expect(dedupeBRollClips([...clips])).toEqual(clips);
  });

  it('drops a repeat and keeps the first occurrence', () => {
    // The exact shape of the shipped botox render: two matched forehead clips
    // cycled to fill a count of four.
    const out = dedupeBRollClips([
      clip('needle-forehead', 0),
      clip('syringe-forehead', 1),
      clip('needle-forehead', 2),
      clip('syringe-forehead', 3),
    ]);
    expect(out.map((c) => c.assetId)).toEqual([
      'needle-forehead',
      'syringe-forehead',
    ]);
  });

  it('renumbers order contiguously from 0 after a drop', () => {
    // A gap in `order` would put the clips out of sequence in the render doc,
    // so dropping without renumbering trades one defect for another.
    const out = dedupeBRollClips([
      clip('a', 0),
      clip('a', 1),
      clip('b', 2),
      clip('a', 3),
      clip('c', 4),
    ]);
    expect(out.map((c) => c.order)).toEqual([0, 1, 2]);
    expect(out.map((c) => c.assetId)).toEqual(['a', 'b', 'c']);
  });

  it('returns a single clip for an all-identical list rather than nothing', () => {
    // Templates declare `count: [1, N]`, so one clip is a legal render. An
    // empty result would fail the export instead.
    const out = dedupeBRollClips([clip('a', 0), clip('a', 1), clip('a', 2)]);
    expect(out).toEqual([clip('a', 0)]);
  });

  it('handles an empty list', () => {
    expect(dedupeBRollClips([])).toEqual([]);
  });

  it('does not mutate its input', () => {
    const clips = [clip('a', 0), clip('a', 1)];
    dedupeBRollClips(clips);
    expect(clips).toHaveLength(2);
  });
});
