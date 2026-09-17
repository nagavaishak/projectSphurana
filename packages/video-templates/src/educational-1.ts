import type { TemplateDoc } from './template-doc.js';

// educational-1 — "Q&A / Association" (Shape D — text-only stack).
//
// The v1 user-facing variation is `narrationMode: 'text_only'`: procedure b-roll
// with the script shown as on-screen text frames — a hook, an association point,
// then a "DM to Learn More" CTA. No voiceover, no captions. The message is
// carried entirely by a `staggered-list` basic block sourced from the script
// slots (lead = hook, items = body, trail = CTA), revealed one frame at a time.
export const educational1: TemplateDoc = {
  id: 'educational-1',
  schemaVersion: 2,
  aspectRatios: ['portrait'],
  // text_only: master length follows the on-screen text frames.
  duration: { kind: 'driven', by: 'frames' },
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
      },
    ],
    overlays: [
      {
        kind: 'staggered-list',
        id: 'frames',
        // `content`: length computed from the script item count; the master is
        // driven by this overlay (see `duration` above).
        duration: { kind: 'content' },
        // Hook — bold brand-coloured heading, no bubble (v1 look).
        lead: {
          text: {
            source: 'query',
            query: { kind: 'script-text', role: 'hook' },
            required: true,
          },
          style: 'heading',
          styleOverride: {
            fontSize: 56,
            fontWeight: 800,
            colorRole: 'primary',
            textShadow: '0 2px 12px rgba(0,0,0,0.45)',
          },
          entrance: 'fade-in',
        },
        // Association point(s) — white bubble pills with dark text (v1 look).
        items: {
          texts: {
            source: 'query',
            query: { kind: 'script-text', role: 'body' },
            required: true,
          },
          style: 'heading',
          styleOverride: { fontSize: 40, fontWeight: 600 },
          container: 'pill',
          entrance: 'slide-up',
        },
        // CTA pill — "DM to Learn More".
        trail: {
          text: {
            source: 'query',
            query: { kind: 'script-text', role: 'cta' },
            required: false,
          },
          style: 'heading',
          styleOverride: { fontSize: 36, fontWeight: 700 },
          container: 'button',
          entrance: 'slide-up',
        },
        // Baseline cadence; educational-2 reads more patiently, -3 slower still.
        stagger: { beatsPerItem: 4 },
        // Accumulate: each frame stacks and stays on screen (v1 look — the hook,
        // points, and CTA are all visible together by the end).
        reveal: 'accumulate',
        align: 'center',
        placement: { anchor: 'center', x: 0.5, y: 0.5, width: 0.84 },
      },
    ],
  },
  globals: {
    audio: {
      // text_only register — no narration, captions undefined.
      music: {
        source: 'query',
        query: { kind: 'music' },
        required: false,
      },
    },
  },
};
