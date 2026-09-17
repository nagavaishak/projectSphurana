import type { TemplateDoc } from './template-doc.js';

// aesthetic-line-1 — "Aesthetic Line" (organic, v1 port)
//
// A single understated italic-serif line, lower-third, that fades in gently and
// then holds for the whole clip over calm procedure b-roll. Quiet, relatable
// vibe. Music only — no narration, no captions (v1 narrationMode: text_only).
//
// This is a faithful renderdoc port of the v1 AestheticLineLayer
// (packages/remotion/src/components/aesthetic-line-layer.tsx), built entirely
// from plain generic blocks:
//   - spine: a single media-track of procedure b-roll, full-bleed, looping
//   - overlay: one `text` block (the italic serif line), fade-in over ~18
//     frames, holding (duration: fill) for the whole clip.
//
// v1 design source of truth:
//   - serif: Playfair italic, 52px, weight 400, white
//   - textShadow: '0 2px 18px rgba(0,0,0,0.6), 0 1px 3px rgba(0,0,0,0.7)'
//   - centered text, vertical position 50% (lower-third feel), maxWidth 78%
//   - fade-in over 18 frames, then hold

const FPS = 30;
// Fallback length only (music-only template, no narration to drive it).
const TOTAL_FRAMES = 10 * FPS;

/** Frames the line takes to gently fade in (matches v1 FADE_IN_FRAMES). */
const FADE_IN_FRAMES = 18;

export const aestheticLine1: TemplateDoc = {
  id: 'aesthetic-line-1',
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
      // The single understated italic-serif line — fades in gently, then holds
      // for the rest of the clip (duration: fill).
      {
        kind: 'text',
        id: 'aesthetic-line',
        text: {
          source: 'query',
          query: { kind: 'script-text', role: 'hook' },
          required: true,
        },
        // `display` resolves to Playfair; styleOverride carries v1's hand-tuned
        // italic-serif values verbatim.
        style: 'display',
        styleOverride: {
          fontStyle: 'italic',
          textTransform: 'none',
          fontSize: 52,
          fontWeight: 400,
          color: '#FFFFFF',
          textShadow: '0 2px 18px rgba(0,0,0,0.6), 0 1px 3px rgba(0,0,0,0.7)',
          strokeWidth: 0,
        },
        animation: {
          entrance: 'fade-in',
          entranceDurationFrames: FADE_IN_FRAMES,
        },
        // Centered, vertical 50% (lower-third feel), width 78% (v1 maxWidth).
        placement: { anchor: 'center', x: 0.5, y: 0.5, width: 0.78 },
        // Hold for the whole clip.
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
