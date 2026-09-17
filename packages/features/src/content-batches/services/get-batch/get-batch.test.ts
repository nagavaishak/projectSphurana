import { describe, expect, it } from '@borradh-workspace/testing';
import { interleaveByKind } from './get-batch.service.js';

/**
 * `interleaveByKind` is pure, so these exercise it directly rather than through
 * `getBatch` — no db mock needed, and the ordering contract is the thing worth
 * pinning.
 */

const item = (kind: string, position: number) => ({ kind, position });
const shape = (items: { kind: string; position: number }[]) =>
  items.map((i) => `${i.kind[0]}${i.position}`).join(' ');

describe('interleaveByKind', () => {
  it('alternates kinds when counts are equal', () => {
    const result = interleaveByKind([
      item('graphic', 0),
      item('graphic', 1),
      item('graphic', 2),
      item('graphic', 3),
      item('video', 0),
      item('video', 1),
      item('video', 2),
      item('video', 3),
    ]);

    expect(shape(result)).toBe('g0 v0 g1 v1 g2 v2 g3 v3');
  });

  it('never emits every graphic before every video', () => {
    const result = interleaveByKind([
      item('graphic', 0),
      item('graphic', 1),
      item('graphic', 2),
      item('video', 0),
      item('video', 1),
      item('video', 2),
    ]);

    const kinds = result.map((i) => i.kind);
    const firstVideo = kinds.indexOf('video');
    const lastGraphic = kinds.lastIndexOf('graphic');

    // A block ordering would put every graphic before the first video.
    expect(firstVideo).toBeLessThan(lastGraphic);
  });

  it('spreads the rarer kind through the common one instead of tailing it', () => {
    const result = interleaveByKind([
      item('graphic', 0),
      item('graphic', 1),
      item('graphic', 2),
      item('graphic', 3),
      item('graphic', 4),
      item('graphic', 5),
      item('video', 0),
      item('video', 1),
    ]);

    const videoIndexes = result
      .map((i, index) => ({ kind: i.kind, index }))
      .filter((i) => i.kind === 'video')
      .map((i) => i.index);

    // Both videos land inside the queue, not bunched at either end.
    expect(videoIndexes[0]).toBeGreaterThan(0);
    expect(videoIndexes[1]).toBeLessThan(result.length - 1);
    expect(videoIndexes[1] - videoIndexes[0]).toBeGreaterThan(1);
  });

  it('keeps each kind in ascending position order', () => {
    const result = interleaveByKind([
      item('video', 2),
      item('graphic', 1),
      item('video', 0),
      item('graphic', 0),
      item('video', 1),
      item('graphic', 2),
    ]);

    const positionsFor = (kind: string) =>
      result.filter((i) => i.kind === kind).map((i) => i.position);

    expect(positionsFor('graphic')).toEqual([0, 1, 2]);
    expect(positionsFor('video')).toEqual([0, 1, 2]);
  });

  it('is deterministic regardless of input order', () => {
    const items = [
      item('graphic', 0),
      item('graphic', 1),
      item('video', 0),
      item('video', 1),
      item('video', 2),
    ];

    const forward = shape(interleaveByKind(items));
    const reversed = shape(interleaveByKind([...items].reverse()));

    expect(forward).toBe(reversed);
  });

  it('handles a single kind and an empty batch', () => {
    expect(
      shape(interleaveByKind([item('graphic', 1), item('graphic', 0)]))
    ).toBe('g0 g1');
    expect(interleaveByKind([])).toEqual([]);
  });

  it('places a regenerated replacement in the slot it supersedes', () => {
    // The replacement carries the same kind + position as the row it replaces.
    const result = interleaveByKind([
      item('graphic', 0),
      item('video', 0),
      item('video', 1),
      item('graphic', 1),
    ]);

    expect(shape(result)).toBe('g0 v0 g1 v1');
  });
});
