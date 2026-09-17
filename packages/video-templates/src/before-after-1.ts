import type { TemplateDoc } from './template-doc.js';

// before-after-1 — "Classic Transformation"
//
// Shape C (per the design doc Appendix): a single leaf region driven by an
// environmental b-roll spine, with a sequence of overlays — a corner PiP
// showing the BEFORE photo, a text interstitial, then a full-bleed AFTER
// reveal with Ken Burns. An info-card outro lands on the final frames.
//
// Total master duration: 12s @ 30fps = 360 frames. This matches the v1
// before-after pipeline's effective master length (PiP ~3s + gap + text 2s
// + post-text buffer ~1s + AFTER reveal ~3s + outro 3s ≈ 12s).
//
// Music is the only global audio. No narration, no captions on Shape C.

const FPS = 30;
const TOTAL_FRAMES = 12 * FPS;

const PIP_DURATION_FRAMES = 3 * FPS;
const INTERSTITIAL_DELAY_FRAMES = Math.round(1.5 * FPS);
const INTERSTITIAL_DURATION_FRAMES = 2 * FPS;
const AFTER_REVEAL_DURATION_FRAMES = 3 * FPS;
const OUTRO_DURATION_FRAMES = 3 * FPS;

export const beforeAfter1: TemplateDoc = {
  id: 'before-after-1',
  schemaVersion: 2,
  aspectRatios: ['portrait'],
  // Voiceover-driven length (compiler overrides with the resolved narration
  // length); falls back to the fixed reveal length when there's no narration.
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
      // 1. BEFORE PiP — corner thumbnail of the before photo, appears at start.
      {
        kind: 'media-overlay',
        id: 'before-pip',
        clip: {
          source: 'query',
          query: { kind: 'asset-media', tag: 'before', mediaType: 'image' },
          required: true,
        },
        placement: { kind: 'corner', corner: 'tr', sizeRatio: 0.3 },
        fit: 'cover',
        label: {
          text: { source: 'fixed', value: 'BEFORE' },
          style: 'caption',
          corner: 'bl',
        },
        duration: { kind: 'fixed', frames: PIP_DURATION_FRAMES },
        // Anchored at start of master timeline via the renderer's default
        // (overlays without explicit positioning start at t=0 of their region).
      },
      // 2. AFTER full-bleed reveal with a gentle Ken Burns — the payoff frame.
      // (Voiceover + TikTok captions now carry the words, so the old dark text
      // interstitial and info-card outro are gone — captions-led, like v1.)
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
          from: 'center',
          zoomFrom: 1.0,
          // Subtle zoom — a big zoom upscales the photo and looks soft.
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
      // Voiceover (AI or custom, decided per-video by the compiler from
      // draftConfig) + word-by-word captions — consistent with the other v2
      // templates. text_only still works (no narration → no captions).
      narration: { source: 'tts', fromScript: true },
      music: {
        source: 'query',
        query: { kind: 'music', mood: 'uplifting', bpm: [100, 130] },
        required: false,
      },
    },
    captions: { from: 'narration', style: 'caption' },
  },
};

// Reference timings — exported for the synthesizer / converter to mirror v1
// pipeline output when stitching legacy assets into this template.
export const BEFORE_AFTER_1_TIMINGS = {
  fps: FPS,
  totalFrames: TOTAL_FRAMES,
  pipDurationFrames: PIP_DURATION_FRAMES,
  interstitialDelayFrames: INTERSTITIAL_DELAY_FRAMES,
  interstitialDurationFrames: INTERSTITIAL_DURATION_FRAMES,
  afterRevealDurationFrames: AFTER_REVEAL_DURATION_FRAMES,
  outroDurationFrames: OUTRO_DURATION_FRAMES,
} as const;
