import type { TemplateDoc } from './template-doc.js';

// educational-2 — "Common Doubts / Worries" (Shape D — text-only stack,
// reassurance register).
//
// v1 user-facing variation is `narrationMode: 'text_only'`: procedure b-roll
// with the script shown as on-screen text frames. Unlike educational-1/3 it does
// NOT close on a CTA pill — the rebuttal stack ends on a calm disclaimer card.
// So the `staggered-list` carries the hook + reassuring facts (no trail), and a
// trailing `info-card` outro shows the disclaimer plus the brand name. The
// reassurance identity is preserved through the calmer treatment: slower b-roll
// cuts, a longer dwell per fact, and a "professional" music bed.
export const educational2: TemplateDoc = {
  id: 'educational-2',
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
        // Slower cuts than educational-1's 4-beat cadence so the b-roll feels
        // considered — matches the reassurance register.
        cuts: { mode: 'beat-synced', beatsPerEdit: 6 },
      },
    ],
    overlays: [
      {
        kind: 'staggered-list',
        id: 'frames',
        duration: { kind: 'content' },
        // Hook — quieter `caption` style (vs educational-1's heading) so the
        // opener reads as a measured question, not a sales hook. Brand-coloured,
        // no bubble (v1 look).
        lead: {
          text: {
            source: 'query',
            query: { kind: 'script-text', role: 'hook' },
            required: true,
          },
          style: 'caption',
          styleOverride: {
            fontSize: 52,
            fontWeight: 800,
            colorRole: 'primary',
            textShadow: '0 2px 12px rgba(0,0,0,0.45)',
          },
          entrance: 'fade-in',
        },
        // Reassuring facts — white bubble pills with dark text (v1 look).
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
        // No trail: the closing beat is the disclaimer info-card below, not a
        // CTA pill.
        // -2 reads the rebuttal stack more patiently than educational-1's 4 so
        // each fact lands.
        stagger: { beatsPerItem: 6 },
        // Accumulate: facts stack and stay on screen (v1 look).
        reveal: 'accumulate',
        align: 'center',
        placement: { anchor: 'center', x: 0.5, y: 0.5, width: 0.84 },
      },
      // Outro — disclaimer headline + brand name, pinned to the final ~3s.
      {
        kind: 'info-card',
        id: 'outro',
        layout: 'centered',
        headline: {
          text: {
            source: 'query',
            query: { kind: 'script-text', role: 'disclaimer' },
            required: false,
          },
          style: 'caption',
        },
        cta: {
          text: {
            source: 'query',
            query: { kind: 'brand', field: 'businessName' },
            required: false,
          },
          style: 'heading',
        },
        background: { kind: 'solid', color: '#000000' },
        entrance: { animation: 'fade-in' },
        duration: { kind: 'fixed', frames: 90 },
        start: 'from-end',
        placement: {
          anchor: 'center',
          x: 0.5,
          y: 0.5,
          width: 0.9,
          height: 0.9,
        },
      },
    ],
  },
  globals: {
    audio: {
      // text_only register — no narration, captions undefined.
      music: {
        // Calmer mood — this is a reassurance video, not a sales pitch.
        source: 'query',
        query: { kind: 'music', mood: 'professional' },
        required: false,
      },
    },
  },
};
