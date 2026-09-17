import { describe, expect, it } from 'vitest';
import { BEFORE_AFTER_2_TIMINGS, beforeAfter2 } from './before-after-2.js';
import { templateDocSchema } from './schemas.js';

describe('beforeAfter2', () => {
  it('parses against templateDocSchema', () => {
    const parsed = templateDocSchema.safeParse(beforeAfter2);
    if (!parsed.success) {
      throw new Error(
        `before-after-2 failed to parse: ${JSON.stringify(parsed.error.issues, null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it('declares portrait-only aspect ratio', () => {
    expect(beforeAfter2.aspectRatios).toEqual(['portrait']);
  });

  it('is captions-led: no dark reveal-interstitial overlay', () => {
    if (beforeAfter2.root.kind !== 'leaf') throw new Error('expected leaf');
    const interstitial = beforeAfter2.root.overlays.find(
      (o) => o.id === 'reveal-interstitial'
    );
    expect(interstitial).toBeUndefined();
  });

  it('puts the BEFORE pip in the bottom-left for differentiation from variant 1', () => {
    if (beforeAfter2.root.kind !== 'leaf') throw new Error('expected leaf');
    const pip = beforeAfter2.root.overlays.find((o) => o.id === 'before-pip');
    if (pip?.kind !== 'media-overlay')
      throw new Error('expected media-overlay');
    if (typeof pip.placement === 'string' || pip.placement.kind !== 'corner') {
      throw new Error('expected corner placement');
    }
    expect(pip.placement.corner).toBe('bl');
  });

  it('uses a left-origin Ken Burns on the AFTER reveal', () => {
    if (beforeAfter2.root.kind !== 'leaf') throw new Error('expected leaf');
    const after = beforeAfter2.root.overlays.find(
      (o) => o.id === 'after-reveal'
    );
    if (after?.kind !== 'media-overlay')
      throw new Error('expected media-overlay');
    expect(after.kenBurns?.zoomTo).toBeGreaterThan(
      after.kenBurns?.zoomFrom ?? 0
    );
    expect(after.kenBurns?.from).toBe('left');
  });

  it('master duration matches the sum of exported timings', () => {
    expect(beforeAfter2.duration).toEqual({
      kind: 'fixed',
      frames: BEFORE_AFTER_2_TIMINGS.totalFrames,
    });
  });

  it('is captions-led: TTS narration + music + captions', () => {
    expect(beforeAfter2.globals.audio.music).toBeDefined();
    expect(beforeAfter2.globals.audio.narration).toEqual({
      source: 'tts',
      fromScript: true,
    });
    expect(beforeAfter2.globals.captions).toBeDefined();
  });
});
