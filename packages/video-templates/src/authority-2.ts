// authority-2 — "AI Voiceover — Credibility" port (Wave 6-B Shape B).
//
// Shape B (see design doc Appendix): leaf region with a `media-track` spine
// (b-roll, fill duration, beat-synced cuts) plus a TTS narration global. No
// talking-head clip. Whisper captions are derived from the narrator audio.
//
// Overlay structure mirrors the v1 script beats: hook card (clinic credibility
// line), body points (pain points / clients-served / outcomes), CTA (book a
// consultation). The actual text comes from the script generator at synthesis
// time — these slots are role-tagged, not hard-coded.
//
// Master duration is `driven by 'narration'` so the timeline expands to fit
// the TTS audio. The media-track is `fill` so b-roll stretches to match.

import type { TemplateDoc } from './template-doc.js';

export const authority2: TemplateDoc = {
  id: 'authority-2',
  schemaVersion: 2,
  aspectRatios: ['portrait'],
  // TTS-driven master timeline (§8). Renderer/compiler use the resolved TTS
  // duration as the total composition length; `fill` blocks expand to match.
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
        cuts: { mode: 'beat-synced', beatsPerEdit: 4 },
      },
    ],
    // Captions-led (v1 parity): the voiceover + word-by-word TikTok captions
    // carry the message, so there are no on-screen text-list overlays.
    overlays: [],
  },
  globals: {
    audio: {
      // Wave 4-A TTS path. `fromScript: true` tells Phase B to lift the script
      // text out of resolved script slots and feed it to the synthesizer.
      // `voice` left undefined — the brand/voice cascade fills it in. Per-org
      // voice selection is wave-7 follow-up; for now Phase B uses its default.
      narration: { source: 'tts', fromScript: true },
      // Optional music bed. Required:false so a render proceeds without
      // music if the org has no preferred track yet.
      music: {
        source: 'query',
        query: { kind: 'music', mood: 'professional' },
        required: false,
      },
    },
    // Whisper captions over the TTS narration. Style binds to the active
    // theme's `caption` typeStyle so contrast / font follow the brand.
    captions: { from: 'narration', style: 'caption' },
  },
};
