// authority-3 — "AI Voiceover — Proof/Standards" port (Wave 6-B Shape B).
//
// Same Shape B as authority-2 (b-roll spine + TTS narration + Whisper
// captions) but tuned for an ultra-safe, trust-heavy register: fade-in
// entrance instead of slide-up, no container chrome on the body items, and a
// `display`-style hook for the consultation-first opener.
//
// In v1 the two variations differed only in the *script template prompt*
// (credibility vs proof/standards tone); the visual layout, clip mix, and
// rendering config were identical. In v2 we preserve that: structural shape
// is the same, but the entrance/style tokens shift to give a calmer,
// professional feel.

import type { TemplateDoc } from './template-doc.js';

export const authority3: TemplateDoc = {
  id: 'authority-3',
  schemaVersion: 2,
  aspectRatios: ['portrait'],
  duration: { kind: 'driven', by: 'narration' },
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
        // Slower edits than authority-2 — every 6 beats — so the b-roll feels
        // considered rather than energetic. Reinforces the "standards" tone.
        cuts: { mode: 'beat-synced', beatsPerEdit: 6 },
      },
    ],
    // Captions-led (v1 parity): voiceover + word-by-word TikTok captions carry
    // the message, so there are no on-screen text-list overlays.
    overlays: [],
  },
  globals: {
    audio: {
      narration: { source: 'tts', fromScript: true },
      music: {
        source: 'query',
        query: { kind: 'music', mood: 'professional' },
        required: false,
      },
    },
    captions: { from: 'narration', style: 'caption' },
  },
};
