import type { TemplateDoc } from './template-doc.js';

// curiosity-hook-1 — "Curiosity Hook" (organic)
//
// A bold curiosity-gap CLAIM pinned near the top and a short "watch till the
// end" nudge near the bottom, both in the inverted-stroke look (black fill,
// thick white outline) for contrast over any procedure b-roll. Reuses the
// question-cta layout; only the copy intent differs (a claim, not a question).
// [orig header below]
// question-cta-1 — "Question + Read Caption" (organic, v1 port)
//
// A hooked question pinned near the top of the frame and a "Read caption ⬇"
// style CTA pinned near the bottom, both rendered with the v1 inverted-stroke
// look: black fill on a thick white outline for high contrast over any
// procedure b-roll. Music only — no narration, no captions (v1
// narrationMode: text_only).
//
// Faithful renderdoc port of the v1 QuestionCtaLayer
// (packages/remotion/src/components/question-cta-layer.tsx), built entirely
// from plain generic blocks:
//   - spine: a single media-track of procedure b-roll, full-bleed, looping,
//     beat-synced cuts every 4 beats (v1 beatsPerEdit: 4).
//   - overlay: question `text` near the top, fades in, holds for the clip.
//   - overlay: CTA `text` near the bottom, fades in, holds for the clip.
//
// v1 design source of truth (QuestionCtaLayer + StrokedText):
//   - font: Inter sans, weight 700, lineHeight 1.15
//   - fill #000000, white stroke (#FFFFFF), strokeWidth = round(fontSize*0.18)
//     drawn via `paintOrder: stroke fill` so the fill reads cleanly
//   - question: fontSize 54, top 8%, centered, horizontal padding 6%
//   - CTA:      fontSize 60, bottom 10%, centered, horizontal padding 6%
//   - question fades in over frames [0,10]; CTA fades in over frames [12,24]
//
// The v1 CTA's ~12-frame entrance delay (it starts fading after the question)
// is reproduced via animation.entranceDelayFrames; the CTA stays hidden until
// then, matching v1 exactly.

const FPS = 30;
// Fallback length only (music-only template, no narration to drive it).
const TOTAL_FRAMES = 10 * FPS;

// v1: questionOpacity ramps over frames [0,10] (~10 frames).
const QUESTION_FADE_IN_FRAMES = 10;
// v1: ctaOpacity ramps over frames [12,24] (~12 frames).
const CTA_FADE_IN_FRAMES = 12;

// v1 StrokedText: strokeWidth = round(fontSize * 0.18).
const QUESTION_FONT_SIZE = 54;
const CTA_FONT_SIZE = 60;

export const curiosityHook1: TemplateDoc = {
  id: 'curiosity-hook-1',
  schemaVersion: 2,
  aspectRatios: ['portrait'],
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
        cuts: { mode: 'beat-synced', beatsPerEdit: 4 },
        fit: 'cover',
        fillMode: 'loop',
      },
    ],
    overlays: [
      // Top: the hook/question — black fill, thick white stroke. Fades in, then
      // holds for the whole clip.
      {
        kind: 'text',
        id: 'question',
        text: {
          source: 'query',
          query: { kind: 'script-text', role: 'hook' },
          required: true,
        },
        // `heading` resolves to the sans display face; styleOverride carries
        // v1's hand-tuned inverted-stroke values verbatim.
        style: 'heading',
        styleOverride: {
          fontSize: QUESTION_FONT_SIZE,
          fontWeight: 700,
          textTransform: 'none',
          color: '#000000',
          strokeColor: '#FFFFFF',
          strokeWidth: Math.round(QUESTION_FONT_SIZE * 0.18),
        },
        animation: {
          entrance: 'fade-in',
          entranceDurationFrames: QUESTION_FADE_IN_FRAMES,
        },
        // Centered horizontally, near the top (v1 top: 8%), width 88% (v1
        // padding 6% each side → 88% content width).
        placement: { anchor: 'top', x: 0.5, y: 0.08, width: 0.88 },
        duration: { kind: 'fill' },
        container: 'none',
      },
      // Bottom: the "Read caption ⬇" CTA — same inverted-stroke look, larger.
      {
        kind: 'text',
        id: 'cta',
        text: {
          source: 'query',
          query: { kind: 'script-text', role: 'cta' },
          required: true,
        },
        style: 'heading',
        styleOverride: {
          fontSize: CTA_FONT_SIZE,
          fontWeight: 700,
          textTransform: 'none',
          color: '#000000',
          strokeColor: '#FFFFFF',
          strokeWidth: Math.round(CTA_FONT_SIZE * 0.18),
        },
        animation: {
          entrance: 'fade-in',
          entranceDurationFrames: CTA_FADE_IN_FRAMES,
          // v1: CTA holds until the question has landed, then fades in.
          entranceDelayFrames: 12,
        },
        // Centered horizontally, near the bottom (v1 bottom: 10% → y 0.9),
        // width 88% (v1 padding 6% each side).
        placement: { anchor: 'bottom', x: 0.5, y: 0.9, width: 0.88 },
        duration: { kind: 'fill' },
        container: 'none',
      },
    ],
  },
  globals: {
    audio: {
      // Music only — no narration (v1 narrationMode: text_only).
      music: {
        source: 'query',
        query: { kind: 'music' },
        required: false,
      },
    },
  },
};
