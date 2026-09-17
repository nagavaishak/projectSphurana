// Round-trip validation for educational-2 (Shape D — text-only stack).
//
// Asserts the v2 TemplateDoc parses cleanly against the canonical
// `templateDocSchema`, plus the structural invariants that make educational-2
// stylistically distinct from educational-1 and educational-3:
//   - leaf region (no split)
//   - staggered-list with no `trail` (closing beat is a disclaimer card, not
//     a CTA pill)
//   - trailing info-card outro carrying the disclaimer + brand businessName
//   - no narration (text_only)
//   - no captions (no audio to transcribe)

import { describe, expect, it } from 'vitest';

import { educational2 } from './educational-2.js';
import { templateDocSchema } from './schemas.js';

describe('educational-2 TemplateDoc', () => {
  it('parses against templateDocSchema', () => {
    const result = templateDocSchema.safeParse(educational2);
    if (!result.success) {
      throw new Error(
        `templateDocSchema rejected educational-2: ${JSON.stringify(
          result.error.issues,
          null,
          2
        )}`
      );
    }
    expect(result.success).toBe(true);
  });

  it('uses a single leaf region with one media-track spine', () => {
    expect(educational2.root.kind).toBe('leaf');
    if (educational2.root.kind !== 'leaf') return;
    expect(educational2.root.spine).toHaveLength(1);
    expect(educational2.root.spine[0]?.kind).toBe('media-track');
  });

  it('has a staggered-list WITHOUT a trail CTA (defining beat vs educational-1/3)', () => {
    if (educational2.root.kind !== 'leaf') return;
    const list = educational2.root.overlays.find(
      (o) => o.kind === 'staggered-list'
    );
    expect(list).toBeDefined();
    if (!list || list.kind !== 'staggered-list') return;
    expect(list.trail).toBeUndefined();
  });

  it('closes with an info-card disclaimer outro', () => {
    if (educational2.root.kind !== 'leaf') return;
    const card = educational2.root.overlays.find((o) => o.kind === 'info-card');
    expect(card).toBeDefined();
    if (!card || card.kind !== 'info-card') return;
    // The headline carries the disclaimer script-text role.
    expect(card.headline.text.source).toBe('query');
    if (card.headline.text.source !== 'query') return;
    expect(card.headline.text.query.kind).toBe('script-text');
    if (card.headline.text.query.kind !== 'script-text') return;
    expect(card.headline.text.query.role).toBe('disclaimer');
  });

  it('surfaces the brand businessName via the info-card CTA slot', () => {
    if (educational2.root.kind !== 'leaf') return;
    const card = educational2.root.overlays.find((o) => o.kind === 'info-card');
    if (!card || card.kind !== 'info-card' || !card.cta) {
      throw new Error('expected outro info-card with a cta slot');
    }
    expect(card.cta.text.source).toBe('query');
    if (card.cta.text.source !== 'query') return;
    expect(card.cta.text.query.kind).toBe('brand');
    if (card.cta.text.query.kind !== 'brand') return;
    expect(card.cta.text.query.field).toBe('businessName');
  });

  it('has no narration and no captions (text-only register)', () => {
    expect(educational2.globals.audio.narration).toBeUndefined();
    expect(educational2.globals.captions).toBeUndefined();
  });

  it('uses a slower beat cadence than educational-1', () => {
    if (educational2.root.kind !== 'leaf') return;
    const list = educational2.root.overlays.find(
      (o) => o.kind === 'staggered-list'
    );
    if (!list || list.kind !== 'staggered-list') return;
    // educational-1 uses beatsPerItem: 4; -2 reads the rebuttal stack more
    // patiently so each fact lands. Documented in educational-2.ts.
    expect(list.stagger.beatsPerItem).toBeGreaterThan(4);
  });
});
