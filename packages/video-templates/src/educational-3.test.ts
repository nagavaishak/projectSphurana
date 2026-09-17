// Round-trip validation for educational-3 (Shape D — text-only walkthrough).
//
// Asserts the v2 TemplateDoc parses cleanly against the canonical
// `templateDocSchema`, plus the structural invariants that make educational-3
// stylistically distinct from educational-1 and educational-2:
//   - leaf region (no split)
//   - staggered-list with typewriter entrance on lead+items (mechanism reveal)
//   - display-style hero opener (vs educational-1's heading and -2's caption)
//   - trail uses CTA pill (matches v1 "DM to Learn More" close)
//   - no narration (text_only)
//   - no captions (no audio to transcribe)

import { describe, expect, it } from 'vitest';

import { educational3 } from './educational-3.js';
import { templateDocSchema } from './schemas.js';

describe('educational-3 TemplateDoc', () => {
  it('parses against templateDocSchema', () => {
    const result = templateDocSchema.safeParse(educational3);
    if (!result.success) {
      throw new Error(
        `templateDocSchema rejected educational-3: ${JSON.stringify(
          result.error.issues,
          null,
          2
        )}`
      );
    }
    expect(result.success).toBe(true);
  });

  it('uses a single leaf region with one media-track spine', () => {
    expect(educational3.root.kind).toBe('leaf');
    if (educational3.root.kind !== 'leaf') return;
    expect(educational3.root.spine).toHaveLength(1);
    expect(educational3.root.spine[0]?.kind).toBe('media-track');
  });

  it('uses typewriter entrance on lead and items (mechanism reveal)', () => {
    if (educational3.root.kind !== 'leaf') return;
    const list = educational3.root.overlays.find(
      (o) => o.kind === 'staggered-list'
    );
    if (!list || list.kind !== 'staggered-list') return;
    expect(list.lead?.entrance).toBe('typewriter');
    expect(list.items.entrance).toBe('typewriter');
  });

  it('uses display style for the hero opener (vs heading on educational-1)', () => {
    if (educational3.root.kind !== 'leaf') return;
    const list = educational3.root.overlays.find(
      (o) => o.kind === 'staggered-list'
    );
    if (!list || list.kind !== 'staggered-list') return;
    expect(list.lead?.style).toBe('display');
  });

  it('has a trail CTA (matches v1 "DM to Learn More" close)', () => {
    if (educational3.root.kind !== 'leaf') return;
    const list = educational3.root.overlays.find(
      (o) => o.kind === 'staggered-list'
    );
    if (!list || list.kind !== 'staggered-list') return;
    expect(list.trail).toBeDefined();
    expect(list.trail?.container).toBe('button');
    // The trail switches to slide-up rather than continuing typewriter so
    // the CTA feels like a decisive action call, not another beat. Verifies
    // the stylistic difference documented in the .ts header.
    expect(list.trail?.entrance).toBe('slide-up');
  });

  it('uses an 8-beat stagger (slower than -1 and -2, room for explanation)', () => {
    if (educational3.root.kind !== 'leaf') return;
    const list = educational3.root.overlays.find(
      (o) => o.kind === 'staggered-list'
    );
    if (!list || list.kind !== 'staggered-list') return;
    expect(list.stagger.beatsPerItem).toBe(8);
  });

  it('has no narration and no captions (text-only register)', () => {
    expect(educational3.globals.audio.narration).toBeUndefined();
    expect(educational3.globals.captions).toBeUndefined();
  });
});
