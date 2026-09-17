import type { VideoDraftConfig } from '@borradh-workspace/database';
import { describe, expect, it } from '@borradh-workspace/testing';

import {
  activeTemplateKey,
  buildTextPatch,
  draftWithStagedPatch,
  hasStagedEdits,
  mergePatches,
  parsePendingVideoEdits,
  templateTextFields,
} from './video-edits.js';

const draft = (overrides: Partial<VideoDraftConfig> = {}) =>
  ({
    bRollClips: [],
    captions: {} as never,
    musicVolume: 1,
    orientation: 'portrait',
    ...overrides,
  }) as VideoDraftConfig;

describe('activeTemplateKey', () => {
  it('finds the populated organic template', () => {
    expect(
      activeTemplateKey(draft({ fadeBenefits: { lines: ['a', 'b'] } }))
    ).toBe('fadeBenefits');
  });

  it('is null when no template config is present', () => {
    expect(activeTemplateKey(draft())).toBeNull();
    expect(activeTemplateKey(null)).toBeNull();
  });
});

describe('templateTextFields', () => {
  it('returns only string and string[] leaves', () => {
    const fields = templateTextFields(
      draft({
        fadeBenefits: {
          lines: ['one', 'two'],
          secondsPerLine: 3,
          highlight: true,
          primaryColor: '#fff',
        },
      })
    );

    // `lines` is copy; `secondsPerLine` and `highlight` are template mechanics
    // a model must not rewrite from "change the text".
    expect(fields).toEqual({ lines: ['one', 'two'], primaryColor: '#fff' });
  });
});

describe('buildTextPatch', () => {
  const withLines = draft({ fadeBenefits: { lines: ['one', 'two'] } });

  it('replaces one line of a list field', () => {
    const result = buildTextPatch(withLines, 'lines', 'ONE', 0);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patch).toEqual({ fadeBenefits: { lines: ['ONE', 'two'] } });
    }
  });

  it('names the line the owner counts, not the field', () => {
    // The summary is what the reply is built from, so "lines line 2" would
    // reach the owner verbatim.
    const result = buildTextPatch(withLines, 'lines', 'TWO', 1);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.summary).toBe('line 2 → "TWO"');
  });

  it('refuses a rewrite that changes nothing', () => {
    // Staging a no-op lights up Apply and spends a render producing a
    // byte-identical video — and the reply claims a change the owner then
    // cannot find anywhere on screen.
    const result = buildTextPatch(withLines, 'lines', 'two', 1);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('already reads');
  });

  it('refuses a no-op on a scalar field too', () => {
    const withHeadline = draft({
      captionTease: { headline: 'Same', caption: 'x' },
    } as never);
    const result = buildTextPatch(withHeadline, 'headline', 'Same');

    expect(result.ok).toBe(false);
  });

  it('accumulates a second edit instead of reverting the first', () => {
    // SHIPPED DEFECT. A text patch snapshots the WHOLE array and `mergePatches`
    // replaces arrays wholesale, so a second edit built against the RAW draft —
    // which still lacks the first, because staged edits have not rendered yet —
    // silently reverted edit 1 on apply. The thread showed both as staged.
    const first = buildTextPatch(withLines, 'lines', 'ONE', 0);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const staged = mergePatches({}, first.patch);
    const second = buildTextPatch(
      draftWithStagedPatch(withLines, staged),
      'lines',
      'TWO',
      1
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // Both survive the merge.
    expect(mergePatches(staged, second.patch)).toEqual({
      fadeBenefits: { lines: ['ONE', 'TWO'] },
    });
  });

  it('sees a staged line when judging "already reads"', () => {
    const first = buildTextPatch(withLines, 'lines', 'ONE', 0);
    if (!first.ok) throw new Error('expected a patch');
    const staged = mergePatches({}, first.patch);

    // Asking for the same change twice is a no-op against what is STAGED, even
    // though the rendered draft still says "one".
    const again = buildTextPatch(
      draftWithStagedPatch(withLines, staged),
      'lines',
      'ONE',
      0
    );
    expect(again.ok).toBe(false);
  });

  it('refuses a field that is not on the active template', () => {
    // The whole point of the narrowing: a model naming `bRollClips` must not be
    // able to reach the clip list through a "text" edit.
    const result = buildTextPatch(withLines, 'bRollClips', 'anything');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('not a text field');
  });

  it('refuses an index past the end of the list', () => {
    const result = buildTextPatch(withLines, 'lines', 'third', 5);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('does not exist');
  });

  it('refuses a list field addressed without an index', () => {
    const result = buildTextPatch(withLines, 'lines', 'oops');

    expect(result.ok).toBe(false);
  });

  it('refuses when the video has no template text at all', () => {
    const result = buildTextPatch(draft(), 'lines', 'x', 0);

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.reason).toContain('no editable on-screen text');
  });
});

describe('parsePendingVideoEdits', () => {
  it('reads back a well-formed value', () => {
    const parsedEdits = parsePendingVideoEdits({
      clipOperations: [
        { op: 'remove', index: 0 },
        { op: 'swap', index: 2, assetId: 'asset-9' },
      ],
      patch: { fadeBenefits: { lines: ['a'] } },
    });

    expect(parsedEdits.clipOperations).toHaveLength(2);
    expect(parsedEdits.patch).toEqual({ fadeBenefits: { lines: ['a'] } });
  });

  it('drops malformed operations rather than trusting them', () => {
    // This column holds output that originated with a model, so reading it is
    // validation, not a cast.
    const parsedEdits = parsePendingVideoEdits({
      clipOperations: [
        { op: 'swap', index: 1 }, // no assetId — unusable
        { op: 'nonsense', index: 0 },
        { op: 'remove' }, // no index
        null,
        { op: 'remove', index: 3 },
      ],
      patch: 'not an object',
    });

    expect(parsedEdits.clipOperations).toEqual([{ op: 'remove', index: 3 }]);
    expect(parsedEdits.patch).toEqual({});
  });

  // The clip list editor's operation. It has no `index`, and the guard for a
  // missing index used to run first — so every list the owner arranged was
  // written to the column and dropped on the way back out. The card showed the
  // old cut and Accept reported nothing to render.
  it('reads back a staged replace-all', () => {
    const parsedEdits = parsePendingVideoEdits({
      clipOperations: [{ op: 'replace-all', assetIds: ['c', 'a', 'b'] }],
      patch: {},
    });

    expect(parsedEdits.clipOperations).toEqual([
      { op: 'replace-all', assetIds: ['c', 'a', 'b'] },
    ]);
    expect(hasStagedEdits(parsedEdits)).toBe(true);
  });

  it('drops a replace-all that carries no usable ids', () => {
    const parsedEdits = parsePendingVideoEdits({
      clipOperations: [
        { op: 'replace-all' },
        { op: 'replace-all', assetIds: [] },
        { op: 'replace-all', assetIds: ['ok', 7] },
      ],
      patch: {},
    });

    expect(parsedEdits.clipOperations).toEqual([]);
  });

  it('treats null / junk as nothing staged', () => {
    expect(hasStagedEdits(parsePendingVideoEdits(null))).toBe(false);
    expect(hasStagedEdits(parsePendingVideoEdits('nope'))).toBe(false);
  });
});

describe('mergePatches', () => {
  it('merges within a template key instead of clobbering it', () => {
    const merged = mergePatches(
      { fadeBenefits: { lines: ['a', 'b'] } },
      { fadeBenefits: { ctaText: 'Book now' } }
    );

    expect(merged).toEqual({
      fadeBenefits: { lines: ['a', 'b'], ctaText: 'Book now' },
    });
  });
});
