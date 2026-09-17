import { describe, expect, it } from 'vitest';

import {
  buildDraftClipSelectionPatch,
  getOrderedDraftClipAssetIds,
  isDraftVideoEditable,
} from './video-draft-selection';

describe('buildDraftClipSelectionPatch', () => {
  it('preserves selection order and does not start a render', () => {
    expect(buildDraftClipSelectionPatch(['second', 'first'])).toEqual({
      patch: {
        bRollClips: [
          { assetId: 'second', order: 0 },
          { assetId: 'first', order: 1 },
        ],
      },
      requeueRender: false,
    });
  });
});

describe('draft video live state', () => {
  // `ready` was false until copy-on-write landed: a patch used to overwrite the
  // rendered cut, so editing a finished video destroyed it. It forks now, which
  // is what makes "swap the second clip" possible on the only videos anyone
  // actually has an opinion about.
  it('permits editing a draft, a rendered video, and a failed one', () => {
    expect(isDraftVideoEditable('draft')).toBe(true);
    expect(isDraftVideoEditable('ready')).toBe(true);
    expect(isDraftVideoEditable('failed')).toBe(true);
  });

  // Not caution: `patchDraftConfig` refuses a patch mid-render, so a button
  // here would open a dialog whose confirm always fails.
  it('refuses while a render is in flight', () => {
    expect(isDraftVideoEditable('queued')).toBe(false);
    expect(isDraftVideoEditable('processing')).toBe(false);
  });

  it('refuses when the status is unknown', () => {
    expect(isDraftVideoEditable(null)).toBe(false);
    expect(isDraftVideoEditable(undefined)).toBe(false);
  });

  it('restores the saved clip order from the live draft config', () => {
    expect(
      getOrderedDraftClipAssetIds({
        bRollClips: [
          { assetId: 'last', order: 2 },
          { assetId: 'first', order: 0 },
        ],
      })
    ).toEqual(['first', 'last']);
  });
});
