import type { TemplateDoc } from './template-doc.js';

// before-after-3 — "Process & Results"
//
// Variant of Shape C: walks the viewer through the process. The BEFORE photo
// shows in the top-left as a label-anchored PiP while explainer text plays
// underneath; the AFTER reveal is gentler (slower Ken Burns, slide-up entrance
// via the engine's animation registry) since the focus is the journey rather
// than the shock. The outro carries a fuller CTA + brand label.
//
// Total master duration: 11s @ 30fps = 330 frames. Slightly shorter than v1
// to keep the walk-through feeling clipped, not lingering.

const FPS = 30;
const TOTAL_FRAMES = 11 * FPS;

const PIP_DURATION_FRAMES = Math.round(3.5 * FPS); // PiP stays longer alongside body text
const INTERSTITIAL_DELAY_FRAMES = Math.round(1 * FPS);
const INTERSTITIAL_DURATION_FRAMES = Math.round(2 * FPS);
const AFTER_REVEAL_DURATION_FRAMES = Math.round(3 * FPS);
const OUTRO_DURATION_FRAMES = Math.round(2.5 * FPS);

export const beforeAfter3: TemplateDoc = {
  id: 'before-after-3',
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
      // 1. BEFORE PiP — top-left, pairs with explanatory body text below.
      {
        kind: 'media-overlay',
        id: 'before-pip',
        clip: {
          source: 'query',
          query: { kind: 'asset-media', tag: 'before', mediaType: 'image' },
          required: true,
        },
        placement: { kind: 'corner', corner: 'tl', sizeRatio: 0.32 },
        fit: 'cover',
        label: {
          text: { source: 'fixed', value: 'BEFORE' },
          style: 'caption',
          corner: 'br',
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
          from: 'right',
          zoomFrom: 1.0,
          zoomTo: 1.05,
        },
        label: {
          text: { source: 'fixed', value: 'AFTER' },
          style: 'caption',
          corner: 'tl',
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
        query: { kind: 'music', mood: 'uplifting', bpm: [110, 140] },
        required: false,
      },
    },
    captions: { from: 'narration', style: 'caption' },
  },
};

export const BEFORE_AFTER_3_TIMINGS = {
  fps: FPS,
  totalFrames: TOTAL_FRAMES,
  pipDurationFrames: PIP_DURATION_FRAMES,
  interstitialDelayFrames: INTERSTITIAL_DELAY_FRAMES,
  interstitialDurationFrames: INTERSTITIAL_DURATION_FRAMES,
  afterRevealDurationFrames: AFTER_REVEAL_DURATION_FRAMES,
  outroDurationFrames: OUTRO_DURATION_FRAMES,
} as const;
