import type { TemplateDoc } from './template-doc.js';

// educational-3 — "How It Works" (Shape D — text-only walkthrough).
//
// v1 user-facing variation is `narrationMode: 'text_only'`: procedure b-roll
// with the script shown as on-screen text frames that walk through the mechanism
// (hook → steps → "DM to Learn More"). The `staggered-list` reveals the lead and
// each step with a `typewriter` entrance so the explanation feels like it's
// being spelled out, then the trail switches to a slide-up CTA pill so the close
// reads as a decisive action call rather than another beat. An 8-beat stagger
// (slower than -1 and -2) gives each step room to be read.
export const educational3: TemplateDoc = {
  id: 'educational-3',
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
        // Medium cadence — slower than educational-1 (4) so each process shot
        // has dwell time, faster than educational-2 (6) so it stays energetic.
        cuts: { mode: 'beat-synced', beatsPerEdit: 5 },
      },
    ],
    overlays: [
      {
        kind: 'staggered-list',
        id: 'frames',
        duration: { kind: 'content' },
        // Hero opener — `display` style (vs heading on -1, caption on -2),
        // brand-coloured, no bubble, typed out to introduce the mechanism.
        lead: {
          text: {
            source: 'query',
            query: { kind: 'script-text', role: 'hook' },
            required: true,
          },
          style: 'display',
          styleOverride: {
            colorRole: 'primary',
            textShadow: '0 2px 12px rgba(0,0,0,0.45)',
          },
          entrance: 'typewriter',
        },
        // Process steps — white bubble pills with dark text, typed out.
        items: {
          texts: {
            source: 'query',
            query: { kind: 'script-text', role: 'body' },
            required: true,
          },
          style: 'heading',
          styleOverride: { fontSize: 40, fontWeight: 600 },
          container: 'pill',
          entrance: 'typewriter',
        },
        // CTA pill — switches to slide-up so the close feels decisive, not
        // another typed beat.
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
        // 8 beats — slower than -1 (4) and -2 (6); room to read each step.
        stagger: { beatsPerItem: 8 },
        // Accumulate: steps stack and stay on screen (v1 look).
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
