import type { TemplateDoc } from './template-doc.js';

// Numbered-list template — organic "X things to do…" explainer. Ports v1
// `numbered-list-layer.tsx`: procedure b-roll darkened by a scrim, a bold
// uppercase title, then a numbered list of short tips that reveal one-by-one.
// Music only, text_only (no narration).
export const numberedList1: TemplateDoc = {
  id: 'numbered-list-1',
  schemaVersion: 2,
  aspectRatios: ['portrait'],
  duration: { kind: 'fixed', frames: 12 * 30 },
  root: {
    kind: 'leaf',
    id: 'main',
    spine: [
      // Procedure b-roll fills the frame; beat-synced cuts, looped to length.
      {
        kind: 'media-track',
        id: 'broll',
        duration: { kind: 'fill' },
        clips: {
          source: 'query',
          query: {
            kind: 'asset-clips',
            tag: 'procedure',
            count: [1, 3],
          },
          required: true,
        },
        fit: 'cover',
        cuts: { mode: 'beat-synced', beatsPerEdit: 4 },
        fillMode: 'loop',
      },
      // Dark scrim over the b-roll (v1 rgba(0,0,0,0.45)). Spine paints in order,
      // so this sits above the media-track and below the overlays.
      {
        kind: 'solid',
        id: 'scrim',
        duration: { kind: 'fill' },
        color: { source: 'fixed', value: 'rgba(0,0,0,0.45)' },
      },
    ],
    overlays: [
      {
        kind: 'staggered-list',
        id: 'tips',
        duration: { kind: 'fill' },
        // Title — bold uppercase white, drop shadow, fade in (v1 58px / 800).
        lead: {
          text: {
            source: 'query',
            query: { kind: 'script-text', role: 'hook' },
            required: true,
          },
          style: 'heading',
          styleOverride: {
            fontSize: 58,
            fontWeight: 800,
            textTransform: 'uppercase',
            color: '#FFFFFF',
            textShadow: '0 2px 12px rgba(0,0,0,0.5)',
            strokeWidth: 0,
          },
          entrance: 'fade-in',
        },
        // Tips — white; each fades in IN PLACE (no upward shift) as it emerges;
        // renderer draws the numbered badge because `numbered: true`.
        items: {
          texts: {
            source: 'query',
            query: { kind: 'script-text', role: 'body' },
            required: true,
          },
          style: 'heading',
          styleOverride: {
            fontSize: 38,
            fontWeight: 600,
            textTransform: 'none',
            color: '#FFFFFF',
            textShadow: '0 2px 10px rgba(0,0,0,0.5)',
            strokeWidth: 0,
          },
          entrance: 'fade-in',
        },
        stagger: { beatsPerItem: 1 },
        reveal: 'accumulate',
        numbered: true,
        align: 'center',
        // Left-aligned title + tips (v1 numbered-list). The badge sits to the
        // left of each tip.
        hAlign: 'left',
        placement: { anchor: 'center', x: 0.5, y: 0.5, width: 0.82 },
      },
    ],
  },
  globals: {
    audio: {
      music: {
        source: 'query',
        query: { kind: 'music' },
        required: false,
      },
    },
  },
};
