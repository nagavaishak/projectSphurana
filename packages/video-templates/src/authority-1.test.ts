// Round-trip validation for authority-1 (Shape A).
//
// Asserts the v2 TemplateDoc parses cleanly against the canonical
// `templateDocSchema`, plus the structural invariants Shape A requires:
//   - exactly one spine `media-track` with id 'base-clip'
//   - narration.source === 'clip' and clipRef === 'base-clip'
//   - captions configured from narration (Whisper)
//
// Gate-acceptance + duration-estimate integration tests live next to the
// converter in features/src/videos/converters/convert-authority-1 — those need
// the DB mock + Phase A estimator from the features package.

import { describe, expect, it } from 'vitest';

import { authority1 } from './authority-1.js';
import { templateDocSchema } from './schemas.js';

describe('authority-1 TemplateDoc', () => {
  it('parses against templateDocSchema', () => {
    const result = templateDocSchema.safeParse(authority1);
    if (!result.success) {
      // Surface the first error path so failures are diagnosable.
      throw new Error(
        `templateDocSchema rejected authority-1: ${JSON.stringify(
          result.error.issues,
          null,
          2
        )}`
      );
    }
    expect(result.success).toBe(true);
  });

  it('has the Shape A spine shape (one media-track with id base-clip)', () => {
    expect(authority1.root.kind).toBe('leaf');
    if (authority1.root.kind !== 'leaf') return;
    expect(authority1.root.spine).toHaveLength(1);
    expect(authority1.root.spine[0]?.kind).toBe('media-track');
    expect(authority1.root.spine[0]?.id).toBe('base-clip');
  });

  it('lifts narration audio from the base clip', () => {
    expect(authority1.globals.audio.narration).toEqual({
      source: 'clip',
      clipRef: 'base-clip',
    });
  });

  it('transcribes captions from narration', () => {
    expect(authority1.globals.captions?.from).toBe('narration');
    expect(authority1.globals.captions?.style).toBe('caption');
  });

  it('has b-roll cutaway overlays (Shape A authority pattern)', () => {
    if (authority1.root.kind !== 'leaf') return;
    const cutaways = authority1.root.overlays.filter(
      (o) => o.kind === 'media-overlay'
    );
    // 2–3 cutaways spaced through the talking head — matches v1 authority-1's
    // maxBRollClips: 4 envelope minus the spine clip.
    expect(cutaways.length).toBeGreaterThanOrEqual(2);
    expect(cutaways.length).toBeLessThanOrEqual(3);
  });
});
