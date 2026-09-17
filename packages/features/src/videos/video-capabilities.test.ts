import type { BRollClipConfig } from '@borradh-workspace/database';
import { describe, expect, it } from '@borradh-workspace/testing';
import {
  CLIP_OPERATION_CONTRACTS,
  DRAFT_FIELD_CONTRACTS,
  FOOTAGE_SELECTION,
  applyClipOperation,
  applyClipOperations,
} from './video-capabilities.js';

/**
 * CAPABILITY TESTS.
 *
 * These do not check that the code does what it currently does — they pin what
 * each capability DEPENDS ON, so removing a dependency fails the build instead
 * of reaching a customer.
 *
 * The regression that motivated the video half: `patchDraftVideo` takes
 * `Partial<DraftConfig>` and the merge replaces arrays wholesale, so changing
 * one clip meant resending every clip. The skill text made that live rather
 * than theoretical — it instructed Claire to rebuild the array from whatever
 * subset she had in view, and everything she could not see was dropped. The
 * render succeeded. Nothing reported it.
 *
 * Each test below names the capability it protects.
 */

const clip = (assetId: string, order: number): BRollClipConfig => ({
  assetId,
  order,
  clipType: 'bRoll',
});

const FOUR: BRollClipConfig[] = [
  clip('a', 0),
  clip('b', 1),
  clip('c', 2),
  clip('d', 3),
];

describe('video clip capabilities', () => {
  describe('capability: change one clip, keep the others', () => {
    it('leaves every untouched clip byte-identical', () => {
      // THE property. A swap that rebuilds the list is the bug.
      const result = applyClipOperation(FOUR, {
        op: 'swap',
        index: 1,
        assetId: 'new',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.clips.map((c) => c.assetId)).toEqual([
        'a',
        'new',
        'c',
        'd',
      ]);
      expect(result.clips[0]).toEqual(FOUR[0]);
      expect(result.clips[2]).toEqual(FOUR[2]);
      expect(result.clips[3]).toEqual(FOUR[3]);
    });

    it('declares that it preserves untouched clips', () => {
      expect(CLIP_OPERATION_CONTRACTS.swap.preservesUntouchedClips).toBe(true);
    });

    it('does not renumber — a swap edits in place, it does not reorder', () => {
      const result = applyClipOperation(FOUR, {
        op: 'swap',
        index: 2,
        assetId: 'new',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.clips.map((c) => c.order)).toEqual([0, 1, 2, 3]);
      expect(CLIP_OPERATION_CONTRACTS.swap.renumbersOrder).toBe(false);
    });

    it('drops the stale presigned url with the asset it belonged to', () => {
      // `url` is a resolved-at-render signed link for the OLD asset. Carrying
      // it through a swap renders the clip that was just replaced.
      const withUrl: BRollClipConfig[] = [
        { assetId: 'a', order: 0, url: 'https://signed/a' },
      ];
      const result = applyClipOperation(withUrl, {
        op: 'swap',
        index: 0,
        assetId: 'new',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.clips[0]?.url).toBeUndefined();
    });

    it('is addressable by assetId — Claire has no read of bRollClips', () => {
      // `videos_listDraftClips` returns the video_draft_clip tray, a different
      // representation from the array the renderer consumes. Index-only
      // addressing would declare a capability she cannot aim.
      expect(CLIP_OPERATION_CONTRACTS.swap.addressableBy).toContain('assetId');

      const result = applyClipOperation(FOUR, {
        op: 'swap',
        targetAssetId: 'c',
        assetId: 'new',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.clips.map((c) => c.assetId)).toEqual([
        'a',
        'b',
        'new',
        'd',
      ]);
    });

    it('is addressable by index — the planner produces genuine duplicates', () => {
      // plan-video-detail fills to recommendedClipCount by CYCLING a service's
      // own clips, so the same asset legitimately appears twice. assetId alone
      // cannot name the second occurrence.
      expect(CLIP_OPERATION_CONTRACTS.swap.addressableBy).toContain('index');

      const cycled = [clip('a', 0), clip('b', 1), clip('a', 2)];
      const result = applyClipOperation(cycled, {
        op: 'swap',
        index: 2,
        assetId: 'new',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.clips.map((c) => c.assetId)).toEqual(['a', 'b', 'new']);
    });

    it('refuses an out-of-range index rather than appending', () => {
      const result = applyClipOperation(FOUR, {
        op: 'swap',
        index: 9,
        assetId: 'new',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.reason).toBe('index_out_of_range');
    });

    it('refuses an operation that names no clip at all', () => {
      // The request schema enforces exactly-one, but a refinement cannot narrow
      // the inferred type — so this stays a real runtime failure rather than an
      // assumption. Silently defaulting to index 0 would edit an arbitrary clip.
      const result = applyClipOperation(FOUR, {
        op: 'swap',
        assetId: 'new',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.reason).toBe('address_not_named');
    });

    it('refuses an assetId that is not in the list', () => {
      const result = applyClipOperation(FOUR, {
        op: 'swap',
        targetAssetId: 'absent',
        assetId: 'new',
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.reason).toBe('asset_not_in_clips');
    });
  });

  describe('capability: drop one clip, keep the others', () => {
    it('leaves every untouched clip byte-identical apart from order', () => {
      const result = applyClipOperation(FOUR, { op: 'remove', index: 1 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.clips.map((c) => c.assetId)).toEqual(['a', 'c', 'd']);
      expect(CLIP_OPERATION_CONTRACTS.remove.preservesUntouchedClips).toBe(
        true
      );
    });

    it('recompacts order so the render never sees a gap', () => {
      const result = applyClipOperation(FOUR, { op: 'remove', index: 0 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.clips.map((c) => c.order)).toEqual([0, 1, 2]);
      expect(CLIP_OPERATION_CONTRACTS.remove.renumbersOrder).toBe(true);
    });

    it('refuses to empty the list — an exportless draft fails far from here', () => {
      const result = applyClipOperation([clip('only', 0)], {
        op: 'remove',
        index: 0,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.reason).toBe('would_empty_clips');
    });
  });

  describe('capability: replace the whole list, on purpose', () => {
    it('is declared destructive so it cannot be arrived at by accident', () => {
      // The point is not that this is safe. It is that a caller now has to ask
      // for it BY NAME, instead of reaching it by sending a short array to a
      // generic patch.
      expect(
        CLIP_OPERATION_CONTRACTS['replace-all'].preservesUntouchedClips
      ).toBe(false);
    });

    it('renumbers so a hand-built list still renders in sequence', () => {
      const result = applyClipOperation(FOUR, {
        op: 'replace-all',
        clips: [clip('x', 7), clip('y', 9)],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.clips.map((c) => c.order)).toEqual([0, 1]);
    });
  });

  describe('operations compose', () => {
    it('applies left to right without losing unnamed clips', () => {
      const result = applyClipOperations(FOUR, [
        { op: 'swap', index: 0, assetId: 'new' },
        { op: 'remove', targetAssetId: 'c' },
      ]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.clips.map((c) => c.assetId)).toEqual(['new', 'b', 'd']);
      expect(result.clips.map((c) => c.order)).toEqual([0, 1, 2]);
    });

    it('stops at the first failure rather than half-applying', () => {
      const result = applyClipOperations(FOUR, [
        { op: 'swap', index: 0, assetId: 'new' },
        { op: 'remove', index: 42 },
      ]);

      expect(result.ok).toBe(false);
    });

    it('never mutates the caller’s array', () => {
      applyClipOperations(FOUR, [{ op: 'remove', index: 0 }]);
      expect(FOUR.map((c) => c.assetId)).toEqual(['a', 'b', 'c', 'd']);
    });
  });
});

describe('video footage selection capability', () => {
  it('draws on the org’s own uploads', () => {
    expect(FOOTAGE_SELECTION.ownFootage).toBe(true);
  });

  it('treats stock as a rotation PARTICIPANT, not a tier below', () => {
    // As a fallback, stock only appeared when a service had nothing at all —
    // which is why a service with one clip opened on that clip forever.
    expect(FOOTAGE_SELECTION.stockFootage).toBe(true);
  });

  it('applies the shared quality floor', () => {
    // Videos had none, so a shaky clip was used exactly as readily as a good
    // one. Reusing the graphics floor is deliberate: two floors drift.
    expect(FOOTAGE_SELECTION.qualityFloor).toBe(true);
  });

  it('stamps rotation memory', () => {
    // Without it, selection is order-stable — indistinguishable from working
    // on the first generation and wrong on every one after.
    expect(FOOTAGE_SELECTION.rotationMemory).toBe(true);
  });
});

describe('draft field capabilities', () => {
  it('keeps captions partially patchable', () => {
    // The merge is one level deep. Nesting a caption field deeper would
    // silently start REPLACING instead of merging, and the symptom would be a
    // caption style reverting to default on an unrelated edit.
    expect(DRAFT_FIELD_CONTRACTS['video.captions'].partiallyPatchable).toBe(
      true
    );
  });

  it('names the field each capability owns', () => {
    expect(DRAFT_FIELD_CONTRACTS['video.narration'].field).toBe(
      'narrationType'
    );
    expect(DRAFT_FIELD_CONTRACTS['video.music'].field).toBe('musicTrackId');
  });
});
