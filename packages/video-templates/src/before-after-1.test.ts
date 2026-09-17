// Parse + structural smoke tests for before-after-1.
//
// The video-templates package doesn't yet ship its own test runner — these
// files are still useful: they typecheck under tsc and (once the integrator
// wires vitest) will execute via `pnpm turbo test`. Tests deliberately use
// only `vitest` globals so they're a drop-in once a runner lands.

import { describe, expect, it } from 'vitest';
import { BEFORE_AFTER_1_TIMINGS, beforeAfter1 } from './before-after-1.js';
import { templateDocSchema } from './schemas.js';

describe('beforeAfter1', () => {
  it('parses against templateDocSchema', () => {
    const parsed = templateDocSchema.safeParse(beforeAfter1);
    if (!parsed.success) {
      throw new Error(
        `before-after-1 failed to parse: ${JSON.stringify(parsed.error.issues, null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it('declares portrait-only aspect ratio (Shape C invariant)', () => {
    expect(beforeAfter1.aspectRatios).toEqual(['portrait']);
  });

  it('has a single leaf region with one spine block and two overlays', () => {
    expect(beforeAfter1.root.kind).toBe('leaf');
    if (beforeAfter1.root.kind !== 'leaf') throw new Error('expected leaf');
    expect(beforeAfter1.root.spine).toHaveLength(1);
    expect(beforeAfter1.root.spine[0]?.kind).toBe('media-track');
    expect(beforeAfter1.root.overlays).toHaveLength(2);
  });

  it('overlays are (in order) before-pip, after-reveal (captions-led: no interstitial/outro)', () => {
    if (beforeAfter1.root.kind !== 'leaf') throw new Error('expected leaf');
    const ids = beforeAfter1.root.overlays.map((o) => o.id);
    expect(ids).toEqual(['before-pip', 'after-reveal']);
  });

  it('emits BEFORE/AFTER labels via media-overlay.label', () => {
    if (beforeAfter1.root.kind !== 'leaf') throw new Error('expected leaf');
    const beforePip = beforeAfter1.root.overlays.find(
      (o) => o.id === 'before-pip'
    );
    const afterReveal = beforeAfter1.root.overlays.find(
      (o) => o.id === 'after-reveal'
    );
    if (beforePip?.kind !== 'media-overlay')
      throw new Error('expected media-overlay');
    if (afterReveal?.kind !== 'media-overlay')
      throw new Error('expected media-overlay');
    expect(beforePip.label?.text).toEqual({ source: 'fixed', value: 'BEFORE' });
    expect(afterReveal.label?.text).toEqual({
      source: 'fixed',
      value: 'AFTER',
    });
  });

  it('after-reveal carries kenBurns params for the wave-3 animation registry', () => {
    if (beforeAfter1.root.kind !== 'leaf') throw new Error('expected leaf');
    const afterReveal = beforeAfter1.root.overlays.find(
      (o) => o.id === 'after-reveal'
    );
    if (afterReveal?.kind !== 'media-overlay')
      throw new Error('expected media-overlay');
    expect(afterReveal.kenBurns).toBeDefined();
    expect(afterReveal.kenBurns?.zoomTo).toBeGreaterThan(
      afterReveal.kenBurns?.zoomFrom ?? 0
    );
  });

  it('master duration matches the sum of exported timings (sanity)', () => {
    expect(beforeAfter1.duration).toEqual({
      kind: 'fixed',
      frames: BEFORE_AFTER_1_TIMINGS.totalFrames,
    });
  });

  it('is captions-led: TTS narration + music + captions', () => {
    expect(beforeAfter1.globals.audio.music).toBeDefined();
    expect(beforeAfter1.globals.audio.narration).toEqual({
      source: 'tts',
      fromScript: true,
    });
    expect(beforeAfter1.globals.captions).toBeDefined();
  });
});
