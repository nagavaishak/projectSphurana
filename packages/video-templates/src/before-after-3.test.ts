import { describe, expect, it } from 'vitest';
import { BEFORE_AFTER_3_TIMINGS, beforeAfter3 } from './before-after-3.js';
import { templateDocSchema } from './schemas.js';

describe('beforeAfter3', () => {
  it('parses against templateDocSchema', () => {
    const parsed = templateDocSchema.safeParse(beforeAfter3);
    if (!parsed.success) {
      throw new Error(
        `before-after-3 failed to parse: ${JSON.stringify(parsed.error.issues, null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  });

  it('declares portrait-only aspect ratio', () => {
    expect(beforeAfter3.aspectRatios).toEqual(['portrait']);
  });

  it('is captions-led: no dark reveal-interstitial overlay', () => {
    if (beforeAfter3.root.kind !== 'leaf') throw new Error('expected leaf');
    const interstitial = beforeAfter3.root.overlays.find(
      (o) => o.id === 'reveal-interstitial'
    );
    expect(interstitial).toBeUndefined();
  });

  it('uses a right-origin Ken Burns on the AFTER reveal', () => {
    if (beforeAfter3.root.kind !== 'leaf') throw new Error('expected leaf');
    const after = beforeAfter3.root.overlays.find(
      (o) => o.id === 'after-reveal'
    );
    if (after?.kind !== 'media-overlay')
      throw new Error('expected media-overlay');
    expect(after.kenBurns?.zoomTo).toBeGreaterThan(
      after.kenBurns?.zoomFrom ?? 0
    );
    expect(after.kenBurns?.from).toBe('right');
  });

  it('is captions-led: no info-card outro overlay', () => {
    if (beforeAfter3.root.kind !== 'leaf') throw new Error('expected leaf');
    const outro = beforeAfter3.root.overlays.find((o) => o.id === 'outro');
    expect(outro).toBeUndefined();
  });

  it('master duration matches the sum of exported timings', () => {
    expect(beforeAfter3.duration).toEqual({
      kind: 'fixed',
      frames: BEFORE_AFTER_3_TIMINGS.totalFrames,
    });
  });

  it('is captions-led: TTS narration + music + captions', () => {
    expect(beforeAfter3.globals.audio.music).toBeDefined();
    expect(beforeAfter3.globals.audio.narration).toEqual({
      source: 'tts',
      fromScript: true,
    });
    expect(beforeAfter3.globals.captions).toBeDefined();
  });
});
