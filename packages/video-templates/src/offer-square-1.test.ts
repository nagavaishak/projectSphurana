// Parse + structural smoke tests for offer-square-1.
//
// Following the convention set by before-after-1.test.ts: tests import from
// `vitest` directly and run once the integrator wires a runner. They also
// typecheck under tsc, which is what catches schema drift in CI today.
//
// offer-square-1 is the ONLY wave-6 shape that exercises the recursive
// region tree (§4 — `split` → children → region). Wave-1's
// template-renderer.tsx walks the tree, but no other landed template puts
// a `split` at the root. These tests pin that contract.

import { describe, expect, it } from 'vitest';

import { offerSquare1 } from './offer-square-1.js';
import { templateDocSchema } from './schemas.js';

describe('offerSquare1', () => {
  it('parses against templateDocSchema', () => {
    const parsed = templateDocSchema.safeParse(offerSquare1);
    if (!parsed.success) {
      throw new Error(
        `offer-square-1 failed to parse: ${JSON.stringify(
          parsed.error.issues,
          null,
          2
        )}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it('declares square-only aspect ratio (Shape E invariant)', () => {
    expect(offerSquare1.aspectRatios).toEqual(['square']);
  });

  it('has a horizontal split as its root region (Shape E invariant)', () => {
    expect(offerSquare1.root.kind).toBe('split');
    if (offerSquare1.root.kind !== 'split') return;
    expect(offerSquare1.root.axis).toBe('h');
    expect(offerSquare1.root.children).toHaveLength(2);
  });

  it('preserves the v1 3:2 left:right ratio (matches 648/432 on 1080)', () => {
    if (offerSquare1.root.kind !== 'split') throw new Error('expected split');
    const [left, right] = offerSquare1.root.children;
    expect(left?.ratio).toBe(3);
    expect(right?.ratio).toBe(2);
  });

  it('left pane is a leaf with one media-track spine block', () => {
    if (offerSquare1.root.kind !== 'split') throw new Error('expected split');
    const leftRegion = offerSquare1.root.children[0]?.region;
    expect(leftRegion?.kind).toBe('leaf');
    if (leftRegion?.kind !== 'leaf') return;
    expect(leftRegion.id).toBe('media-pane');
    expect(leftRegion.spine).toHaveLength(1);
    expect(leftRegion.spine[0]?.kind).toBe('media-track');
    expect(leftRegion.overlays).toHaveLength(0);
  });

  it('left pane media-track queries `procedure`-tagged clips (v1 fidelity)', () => {
    if (offerSquare1.root.kind !== 'split') throw new Error('expected split');
    const leftRegion = offerSquare1.root.children[0]?.region;
    if (leftRegion?.kind !== 'leaf') throw new Error('expected leaf');
    const broll = leftRegion.spine[0];
    if (broll?.kind !== 'media-track') throw new Error('expected media-track');
    expect(broll.clips.source).toBe('query');
    if (broll.clips.source !== 'query') return;
    expect(broll.clips.query.kind).toBe('asset-clips');
    if (broll.clips.query.kind !== 'asset-clips') return;
    expect(broll.clips.query.tag).toBe('procedure');
    expect(broll.clips.query.count).toEqual([1, 4]);
  });

  it('right pane is a leaf with a solid spine block + info-card overlay', () => {
    if (offerSquare1.root.kind !== 'split') throw new Error('expected split');
    const rightRegion = offerSquare1.root.children[1]?.region;
    expect(rightRegion?.kind).toBe('leaf');
    if (rightRegion?.kind !== 'leaf') return;
    expect(rightRegion.id).toBe('card-pane');
    expect(rightRegion.spine).toHaveLength(1);
    expect(rightRegion.spine[0]?.kind).toBe('solid');
    expect(rightRegion.overlays).toHaveLength(1);
    expect(rightRegion.overlays[0]?.kind).toBe('info-card');
  });

  it('info-card binds headline/cta to script-text slots (per-video content)', () => {
    if (offerSquare1.root.kind !== 'split') throw new Error('expected split');
    const rightRegion = offerSquare1.root.children[1]?.region;
    if (rightRegion?.kind !== 'leaf') throw new Error('expected leaf');
    const card = rightRegion.overlays[0];
    if (card?.kind !== 'info-card') throw new Error('expected info-card');

    // Headline → script-text role 'hook'
    expect(card.headline.text.source).toBe('query');
    if (card.headline.text.source !== 'query') return;
    expect(card.headline.text.query).toEqual({
      kind: 'script-text',
      role: 'hook',
    });

    // CTA → script-text role 'cta'
    expect(card.cta?.text.source).toBe('query');
    if (card.cta?.text.source !== 'query') return;
    expect(card.cta.text.query).toEqual({ kind: 'script-text', role: 'cta' });
  });

  it("falls back to `fixed` price/currency (slot enum has no 'price' role or 'currency' brand field)", () => {
    if (offerSquare1.root.kind !== 'split') throw new Error('expected split');
    const rightRegion = offerSquare1.root.children[1]?.region;
    if (rightRegion?.kind !== 'leaf') throw new Error('expected leaf');
    const card = rightRegion.overlays[0];
    if (card?.kind !== 'info-card') throw new Error('expected info-card');

    // Both must be `fixed` until wave-7 extends the Slot enums. The
    // converter is responsible for overriding these per-video.
    expect(card.price?.value.source).toBe('fixed');
    expect(card.price?.currency.source).toBe('fixed');
  });

  it('logo URL binds to brand.logoUrl', () => {
    if (offerSquare1.root.kind !== 'split') throw new Error('expected split');
    const rightRegion = offerSquare1.root.children[1]?.region;
    if (rightRegion?.kind !== 'leaf') throw new Error('expected leaf');
    const card = rightRegion.overlays[0];
    if (card?.kind !== 'info-card') throw new Error('expected info-card');
    expect(card.logo?.url.source).toBe('query');
    if (card.logo?.url.source !== 'query') return;
    expect(card.logo.url.query).toEqual({ kind: 'brand', field: 'logoUrl' });
  });

  it('declares music as the only global audio (Shape E invariant — no narration, no captions)', () => {
    expect(offerSquare1.globals.audio.music).toBeDefined();
    expect(offerSquare1.globals.audio.narration).toBeUndefined();
    expect(offerSquare1.globals.captions).toBeUndefined();
  });

  it('uses a fixed master duration (v1 hardcoded 20s for offer-square-1)', () => {
    expect(offerSquare1.duration.kind).toBe('fixed');
    if (offerSquare1.duration.kind !== 'fixed') return;
    expect(offerSquare1.duration.frames).toBe(600); // 20s × 30fps
  });
});
