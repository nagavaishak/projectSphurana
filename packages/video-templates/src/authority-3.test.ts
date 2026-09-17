// Round-trip validation for authority-3 (Shape B — TTS over b-roll, the
// "Proof/Standards" register). Structurally identical to authority-2 — only
// the entrance/style tokens shift — so the test mirrors authority-2's.

import { describe, expect, it } from 'vitest';

import { authority3 } from './authority-3.js';
import { templateDocSchema } from './schemas.js';

describe('authority-3 TemplateDoc', () => {
  it('parses against templateDocSchema', () => {
    const result = templateDocSchema.safeParse(authority3);
    if (!result.success) {
      throw new Error(
        `templateDocSchema rejected authority-3: ${JSON.stringify(
          result.error.issues,
          null,
          2
        )}`
      );
    }
    expect(result.success).toBe(true);
  });

  it('has the Shape B spine shape (one media-track b-roll, no talking head)', () => {
    expect(authority3.root.kind).toBe('leaf');
    if (authority3.root.kind !== 'leaf') return;
    expect(authority3.root.spine).toHaveLength(1);
    const spine = authority3.root.spine[0];
    expect(spine?.kind).toBe('media-track');
    if (!spine || spine.kind !== 'media-track') return;
    if (
      spine.clips.source === 'query' &&
      spine.clips.query.kind === 'asset-clips'
    ) {
      expect(spine.clips.query.tag).not.toBe('employee-talking-head');
    }
  });

  it('uses TTS narration (Shape B invariant)', () => {
    expect(authority3.globals.audio.narration).toEqual({
      source: 'tts',
      fromScript: true,
    });
  });

  it('transcribes captions from narration', () => {
    expect(authority3.globals.captions?.from).toBe('narration');
    expect(authority3.globals.captions?.style).toBe('caption');
  });

  it('master timeline is driven by narration', () => {
    expect(authority3.duration).toEqual({
      kind: 'driven',
      by: 'narration',
    });
  });

  it('uses a slower 6-beat cut cadence (proof/standards tone)', () => {
    if (authority3.root.kind !== 'leaf') return;
    const spine = authority3.root.spine[0];
    if (!spine || spine.kind !== 'media-track') return;
    expect(spine.cuts).toEqual({ mode: 'beat-synced', beatsPerEdit: 6 });
  });
});
