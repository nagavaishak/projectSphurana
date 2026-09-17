// Round-trip validation for authority-2 (Shape B — TTS over b-roll).
//
// Asserts the v2 TemplateDoc parses cleanly against `templateDocSchema` plus
// the structural invariants Shape B requires:
//   - exactly one spine `media-track` (b-roll, no talking-head clip)
//   - narration.source === 'tts'
//   - captions configured from narration (Whisper)
//
// Integration tests (converter, gate, estimator) live in
// packages/features/src/videos/converters/convert-authority-tts.

import { describe, expect, it } from 'vitest';

import { authority2 } from './authority-2.js';
import { templateDocSchema } from './schemas.js';

describe('authority-2 TemplateDoc', () => {
  it('parses against templateDocSchema', () => {
    const result = templateDocSchema.safeParse(authority2);
    if (!result.success) {
      throw new Error(
        `templateDocSchema rejected authority-2: ${JSON.stringify(
          result.error.issues,
          null,
          2
        )}`
      );
    }
    expect(result.success).toBe(true);
  });

  it('has the Shape B spine shape (one media-track b-roll, no talking head)', () => {
    expect(authority2.root.kind).toBe('leaf');
    if (authority2.root.kind !== 'leaf') return;
    expect(authority2.root.spine).toHaveLength(1);
    const spine = authority2.root.spine[0];
    expect(spine?.kind).toBe('media-track');
    if (!spine || spine.kind !== 'media-track') return;
    // b-roll, not talking-head
    if (
      spine.clips.source === 'query' &&
      spine.clips.query.kind === 'asset-clips'
    ) {
      expect(spine.clips.query.tag).not.toBe('employee-talking-head');
    }
  });

  it('uses TTS narration (Shape B invariant)', () => {
    expect(authority2.globals.audio.narration).toEqual({
      source: 'tts',
      fromScript: true,
    });
  });

  it('transcribes captions from narration', () => {
    expect(authority2.globals.captions?.from).toBe('narration');
    expect(authority2.globals.captions?.style).toBe('caption');
  });

  it('master timeline is driven by narration', () => {
    expect(authority2.duration).toEqual({
      kind: 'driven',
      by: 'narration',
    });
  });
});
