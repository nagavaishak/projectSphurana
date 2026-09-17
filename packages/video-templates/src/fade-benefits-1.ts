import type { TemplateDoc } from './template-doc.js';

// Fade Benefits template — v1 organic "fade-benefits-1" ported to renderdoc with
// plain generic blocks only. Short benefit STATEMENTS show ONE AT A TIME over
// calm procedure b-roll; each statement reveals WORD-BY-WORD (each word fades in
// and rises into place), holds, then the next statement replaces it. Centered
// bold Playfair serif, music only, no captions/voiceover (text_only).
export const fadeBenefits1: TemplateDoc = {
  id: 'fade-benefits-1',
  schemaVersion: 2,
  // Driven by the benefits list so the total length scales with the statement
  // count (name + 3-4 benefits) at a comfortable per-line hold, instead of
  // cramming everything into a fixed master (which made the cuts feel rushed).
  duration: { kind: 'driven', by: 'benefits' },
  aspectRatios: ['portrait'],
  root: {
    kind: 'leaf',
    id: 'main',
    spine: [
      // Calm procedure b-roll. `overlay-synced` cuts the scene on every benefit
      // statement (v1: 1 clip ↔ 1 line), cycling the uploaded clips when there
      // are fewer clips than statements.
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
        cuts: { mode: 'overlay-synced' },
        fillMode: 'loop',
      },
    ],
    overlays: [
      // One staggered list driving the sequential benefit statements. Each item
      // is a full statement; `reveal: 'sequential'` shows exactly one statement
      // on screen at a time; `entrance: 'word-by-word'` reveals each word with a
      // soft fade + rise — matching the v1 FadeStatement cadence.
      {
        kind: 'staggered-list',
        id: 'benefits',
        duration: { kind: 'content' },
        // Line 1 is JUST the service/procedure name — it opens the video (v1).
        // Same serif look as the statements; it's the first sequential beat, so
        // the first b-roll clip shows under the name.
        lead: {
          text: {
            source: 'query',
            query: { kind: 'script-text', role: 'hook' },
            required: true,
          },
          style: 'display',
          styleOverride: {
            textTransform: 'none',
            fontSize: 60,
            fontWeight: 700,
            color: '#FFFFFF',
            textShadow:
              '0 2px 18px rgba(0,0,0,0.55), 0 1px 3px rgba(0,0,0,0.7)',
            strokeWidth: 0,
          },
          entrance: 'word-by-word',
        },
        items: {
          texts: {
            source: 'query',
            query: { kind: 'script-text', role: 'body' },
            required: true,
          },
          // `display` token = Playfair serif. Hand-tuned overrides carry v1's
          // exact look: 60px, weight 700, white, soft drop shadow, no stroke,
          // no uppercasing (statements are sentence-case).
          style: 'display',
          styleOverride: {
            textTransform: 'none',
            fontSize: 60,
            fontWeight: 700,
            color: '#FFFFFF',
            textShadow:
              '0 2px 18px rgba(0,0,0,0.55), 0 1px 3px rgba(0,0,0,0.7)',
            strokeWidth: 0,
          },
          entrance: 'word-by-word',
        },
        // ~2.3s per line: at ~110bpm, (60/110)*30*4 ≈ 2.2s — ~40% quicker than
        // the 7-beat hold, so the scene/line changes land with more energy.
        stagger: { beatsPerItem: 4 },
        reveal: 'sequential',
        align: 'center',
        // Centered block at ~50% height, max width ~82% (v1 VERTICAL_POSITION
        // / maxWidth).
        placement: {
          anchor: 'center',
          x: 0.5,
          y: 0.5,
          width: 0.82,
        },
      },
    ],
  },
  globals: {
    audio: {
      // Music only — no narration (text_only template).
      music: {
        source: 'query',
        query: { kind: 'music' },
        required: false,
      },
    },
    // No captions: the on-screen statements carry the message.
  },
};
