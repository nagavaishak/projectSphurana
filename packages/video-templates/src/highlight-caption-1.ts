import type { TemplateDoc } from './template-doc.js';

// Highlight Caption — the dominant reel text format observed in the aesthetic /
// skincare niche (white text on solid brand-colour "highlight" blocks, revealed
// one line at a time, e.g. dianadanielleb "My body changed. So did my
// understanding of why.", 1M+ views). Short statements reveal SEQUENTIALLY, each
// sitting on its own solid `plate` backing so it stays legible over busy
// procedure b-roll. Sans display face, uppercase off, music only (text_only).
//
// Built entirely from existing generic blocks — no new Remotion component:
//   - spine: procedure b-roll, `overlay-synced` cuts (1 clip ↔ 1 line)
//   - overlay: a `staggered-list`, `reveal: 'sequential'`, `container: 'plate'`
//     on every item so each line renders on a solid rounded block.
export const highlightCaption1: TemplateDoc = {
  id: 'highlight-caption-1',
  schemaVersion: 2,
  // Driven by the statement list so length scales with line count (hook +
  // 3-5 caption lines) at a comfortable per-line hold.
  duration: { kind: 'driven', by: 'lines' },
  aspectRatios: ['portrait'],
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
        cuts: { mode: 'overlay-synced' },
        fillMode: 'loop',
      },
    ],
    overlays: [
      {
        kind: 'staggered-list',
        id: 'lines',
        duration: { kind: 'content' },
        // Opening hook line — same highlight treatment; it's the first
        // sequential beat, so the first clip shows under it.
        lead: {
          text: {
            source: 'query',
            query: { kind: 'script-text', role: 'hook' },
            required: true,
          },
          style: 'heading',
          styleOverride: {
            textTransform: 'none',
            fontSize: 56,
            fontWeight: 700,
            color: '#FFFFFF',
            strokeWidth: 0,
          },
          // Solid rounded backing block — the "highlight caption" look. Its fill
          // resolves to the brand colour via the theme (same plate the info-card
          // interstitials use), so each line reads as a branded highlight bar.
          container: 'plate',
          entrance: 'fade-in',
        },
        items: {
          texts: {
            source: 'query',
            query: { kind: 'script-text', role: 'body' },
            required: true,
          },
          style: 'heading',
          styleOverride: {
            textTransform: 'none',
            fontSize: 56,
            fontWeight: 700,
            color: '#FFFFFF',
            strokeWidth: 0,
          },
          container: 'plate',
          entrance: 'fade-in',
        },
        // ~2.3s per line at ~110bpm — energetic line/scene changes.
        stagger: { beatsPerItem: 4 },
        // Exactly one highlight line on screen at a time, swapping on each cut.
        reveal: 'sequential',
        align: 'center',
        // Centered block, slightly below middle so the b-roll subject reads.
        placement: {
          anchor: 'center',
          x: 0.5,
          y: 0.55,
          width: 0.84,
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
  },
};
