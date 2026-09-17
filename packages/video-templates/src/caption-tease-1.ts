import type { TemplateDoc } from './template-doc.js';

// caption-tease-1 — "Typewriter Hook" (organic, text_only, no narration)
//
// Ports the v1 organic "caption-tease-1" variation to the renderdoc method
// using only plain generic blocks (media-track + text), no info-card.
//
// v1 design source:
//   - template-definitions.ts `id: 'caption-tease'`:
//       "Centered serif headline with a cursive 'Check the caption' hook.
//        Both reveal with a typewriter animation over a procedure b-roll."
//     variation 'caption-tease-1' ("Typewriter Hook"), narrationMode
//     'text_only': "Headline (with a bolded emphasis word) + cursive caption.
//      Procedure b-roll cuts 2–3 times across ~8 seconds underneath."
//     clipGuidance: 1 clip group, filterTag 'procedure'; recommendedClipCount 3,
//     maxBRollClips 3; renderingConfig showLabels:false, talkingHead 0%.
//   - apps/video-worker/src/main.ts (`variationId === 'caption-tease-1'`):
//     drives draftConfig.captionTease { headline, emphasis?, emoji?, caption,
//     charsPerSecond? } and is gated on text_only + at least one b-roll clip.
//   - packages/remotion/.../typewriter-text-layer.tsx: full-bleed centered
//     stack — serif headline (Playfair, ~78px, weight 500, white, soft drop
//     shadow, emphasis word bolded) typed char-by-char, then after a short gap
//     a cursive caption (Allura, ~84px, white) typed in below it.
//
// Reconstruction with plain blocks (now full-fidelity to v1):
//   - Spine: full-bleed procedure b-roll, beat-synced cuts of 4, fill mode loop,
//     covering the ~8s master.
//   - Overlay 1 (hook): the headline in Playfair serif (styleOverride.fontRef),
//     centered upper-middle, real char-by-char typewriter entrance with a
//     blinking caret. An emphasis word wrapped in `**…**` renders bold (markers
//     stripped) — the v1 bolded-emphasis nicety, now generic.
//   - Overlay 2 (cta): the "check the caption" line in Allura cursive (the v1
//     script face, via fontRef), centered below the headline, typed in after the
//     headline finishes (entranceDelayFrames). Persists to the end.
//
// No narration, no captions (text_only). Music is the only global audio.

const FPS = 30;
const TOTAL_FRAMES = 8 * FPS;

export const captionTease1: TemplateDoc = {
  id: 'caption-tease-1',
  schemaVersion: 2,
  aspectRatios: ['portrait'],
  // Fixed length — organic/text_only has no narration to drive duration.
  duration: { kind: 'fixed', frames: TOTAL_FRAMES },
  root: {
    kind: 'leaf',
    id: 'main',
    spine: [
      {
        kind: 'media-track',
        id: 'broll',
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
        fit: 'cover',
        cuts: { mode: 'beat-synced', beatsPerEdit: 4 },
        fillMode: 'loop',
      },
    ],
    overlays: [
      // 1. Headline — Playfair serif, centered upper-middle, typed char-by-char
      //    over ~1.2s. The script may wrap an emphasis word in `**…**`; the
      //    renderer bolds that run and strips the markers (v1 bolded one word).
      {
        kind: 'text',
        id: 'headline',
        text: {
          source: 'query',
          query: { kind: 'script-text', role: 'hook' },
          required: true,
        },
        style: 'display',
        styleOverride: {
          fontRef: 'playfair',
          fontSize: 78,
          fontWeight: 500,
          textTransform: 'none',
          color: '#FFFFFF',
          letterSpacing: -0.005,
          textShadow: '0 4px 24px rgba(0, 0, 0, 0.55)',
        },
        animation: { entrance: 'typewriter', entranceDurationFrames: 36 },
        placement: { anchor: 'center', x: 0.5, y: 0.4, width: 0.84 },
        duration: { kind: 'fill' },
      },
      // 2. Cursive "check the caption" hook in Allura (the v1 script face),
      //    centered below the headline, typed in after the headline finishes
      //    (entranceDelayFrames ≈ headline type time + a short gap).
      {
        kind: 'text',
        id: 'caption-hook',
        text: {
          source: 'query',
          query: { kind: 'script-text', role: 'cta' },
          required: true,
        },
        style: 'display',
        styleOverride: {
          fontRef: 'allura',
          fontSize: 84,
          fontWeight: 400,
          textTransform: 'none',
          color: '#FFFFFF',
          textShadow: '0 4px 24px rgba(0, 0, 0, 0.55)',
        },
        animation: {
          entrance: 'typewriter',
          entranceDurationFrames: 30,
          entranceDelayFrames: 50,
        },
        placement: { anchor: 'center', x: 0.5, y: 0.62, width: 0.84 },
        duration: { kind: 'fill' },
      },
    ],
  },
  globals: {
    audio: {
      // Organic / text_only — no narration, so no captions either.
      music: {
        source: 'query',
        query: { kind: 'music' },
        required: false,
      },
    },
  },
};
