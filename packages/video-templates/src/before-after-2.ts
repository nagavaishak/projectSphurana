import type { TemplateDoc } from './template-doc.js';

// before-after-2 — "The Reveal"
//
// Variant of Shape C: more suspenseful pacing. The BEFORE PiP lingers longer
// in the bottom-right corner (it's "ours" the audience is watching) and the
// AFTER reveal uses a mask-wipe entrance instead of a soft fade. The
// interstitial text reads "YOU WON'T BELIEVE THIS" — building anticipation
// rather than announcing.
//
// Total master duration: 13s @ 30fps = 390 frames. ~1s longer than v1 to give
// the suspenseful PiP linger more space.

const FPS = 30;
const TOTAL_FRAMES = 13 * FPS;

const PIP_DURATION_FRAMES = Math.round(3.5 * FPS); // longer linger
const INTERSTITIAL_DELAY_FRAMES = Math.round(1.5 * FPS);
const INTERSTITIAL_DURATION_FRAMES = Math.round(2.5 * FPS);
const AFTER_REVEAL_DURATION_FRAMES = Math.round(3.5 * FPS); // bigger payoff
const OUTRO_DURATION_FRAMES = 3 * FPS;

export const beforeAfter2: TemplateDoc = {
  id: 'before-after-2',
  schemaVersion: 2,
  aspectRatios: ['portrait'],
  duration: { kind: 'fixed', frames: TOTAL_FRAMES },
  root: {
    kind: 'leaf',
    id: 'main',
    spine: [
      {
        kind: 'media-track',
        id: 'env',
        duration: { kind: 'fill' },
        clips: {
          source: 'query',
          query: {
            kind: 'asset-clips',
            tag: 'procedure',
            count: [1, 4],
          },
          required: true,
        },
        cuts: { mode: 'beat-synced', beatsPerEdit: 4 },
        fit: 'cover',
        fillMode: 'loop',
      },
    ],
    overlays: [
      // 1. BEFORE PiP — bottom-left this time, smaller, lingers longer.
      {
        kind: 'media-overlay',
        id: 'before-pip',
        clip: {
          source: 'query',
          query: { kind: 'asset-media', tag: 'before', mediaType: 'image' },
          required: true,
        },
        placement: { kind: 'corner', corner: 'bl', sizeRatio: 0.28 },
        fit: 'cover',
        label: {
          text: { source: 'fixed', value: 'BEFORE' },
          style: 'caption',
          corner: 'tl',
        },
        duration: { kind: 'fixed', frames: PIP_DURATION_FRAMES },
      },
      // 2. AFTER reveal — gentle Ken Burns. Voiceover + TikTok captions carry
      // the words now, so the dark interstitial + info-card outro are gone.
      {
        kind: 'media-overlay',
        id: 'after-reveal',
        clip: {
          source: 'query',
          query: { kind: 'asset-media', tag: 'after', mediaType: 'image' },
          required: true,
        },
        placement: 'full-bleed',
        fit: 'cover',
        kenBurns: {
          from: 'left',
          zoomFrom: 1.0,
          zoomTo: 1.05,
        },
        label: {
          text: { source: 'fixed', value: 'AFTER' },
          style: 'caption',
          corner: 'tr',
        },
        duration: { kind: 'fixed', frames: AFTER_REVEAL_DURATION_FRAMES },
      },
    ],
  },
  globals: {
    audio: {
      narration: { source: 'tts', fromScript: true },
      music: {
        source: 'query',
        query: { kind: 'music', mood: 'cinematic', bpm: [80, 120] },
        required: false,
      },
    },
    captions: { from: 'narration', style: 'caption' },
  },
};

export const BEFORE_AFTER_2_TIMINGS = {
  fps: FPS,
  totalFrames: TOTAL_FRAMES,
  pipDurationFrames: PIP_DURATION_FRAMES,
  interstitialDelayFrames: INTERSTITIAL_DELAY_FRAMES,
  interstitialDurationFrames: INTERSTITIAL_DURATION_FRAMES,
  afterRevealDurationFrames: AFTER_REVEAL_DURATION_FRAMES,
  outroDurationFrames: OUTRO_DURATION_FRAMES,
} as const;
