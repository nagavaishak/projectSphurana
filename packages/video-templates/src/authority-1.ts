// Authority-1 — Shape A port (talking-head with b-roll cutaways).
//
// Mirrors v1 `authority-1` ("Clinic Owner On Camera") in
// packages/features/src/videos/templates/template-definitions.ts:110-145.
//
// Shape A per the design doc Appendix:
//   leaf region with one `media-track` spine block holding the recorded
//   talking-head clip plus N `media-overlay` cutaways; the master timeline is
//   driven by the lifted clip audio (narration source = 'clip') and Whisper
//   transcribes that lifted audio into captions.
//
// Cutaway timing — NOTE for follow-up. The v2 TemplateDoc has no explicit
// start-time field on overlays; the spec defers per-overlay placement on the
// master timeline to the generalised duration resolver (P3 §15 in the punch
// list — "resolve(master, beats[]) → absolute[]"). Until that lands, the only
// way to express "this cutaway plays from t≈3s to t≈5s" is with a fixed-frame
// `duration` and a downstream compiler that knows authority-1's overlay
// indices map to specific windows of the spine. We've authored three cutaways
// here as the v1 `maxBRollClips: 4` cap minus one (matching the typical
// authority-1 render: 2–3 b-roll inserts spaced through the talking head).
// At 30 fps each cutaway is ~2.0 s; the compiler positions them at roughly
// 3 s / 7 s / 12 s into the spine — see wave 5's render-doc-compiler for the
// active hardcoded mapping for authority-1.

import type { TemplateDoc } from './template-doc.js';

const FPS = 30;
const CUTAWAY_DURATION_FRAMES = 2 * FPS; // ≈ 2.0s — matches the v1 cutaway dwell.
const OUTRO_DURATION_FRAMES = 3 * FPS; // ≈ 3.0s — matches v1 authority-1's outro.

export const authority1: TemplateDoc = {
  id: 'authority-1',
  schemaVersion: 2,
  aspectRatios: ['portrait'],
  // Master timeline is driven by the talking-head clip's audio length.
  // narration.source = 'clip' + clipRef = 'base-clip' below.
  duration: { kind: 'driven', by: 'narration' },
  root: {
    kind: 'leaf',
    id: 'main',
    spine: [
      {
        kind: 'media-track',
        id: 'base-clip',
        // `fill` over the master = full narration length.
        duration: { kind: 'fill' },
        clips: {
          source: 'query',
          query: {
            kind: 'asset-clips',
            // v1 used `narrationMode: 'recorded'` with the talking-head asset
            // sourced from the draftConfig's talkingHeadAssetId. In v2 it's a
            // tagged-asset query (single clip).
            tag: 'employee-talking-head',
            count: [1, 1],
          },
          required: true,
        },
        fit: 'cover',
        cuts: { mode: 'clip-length' },
        transition: 'cut',
        kenBurnsOnImages: false,
        fillMode: 'hold',
      },
    ],
    overlays: [
      // Cutaway 1 — procedure footage, full-bleed b-roll inserted mid-script.
      {
        kind: 'media-overlay',
        id: 'cutaway-procedure',
        clip: {
          source: 'query',
          query: { kind: 'asset-media', tag: 'procedure', mediaType: 'video' },
          required: false,
        },
        placement: 'full-bleed',
        fit: 'cover',
        duration: { kind: 'fixed', frames: CUTAWAY_DURATION_FRAMES },
      },
      // Cutaway 2 — clinic environment shot.
      {
        kind: 'media-overlay',
        id: 'cutaway-environment',
        clip: {
          source: 'query',
          query: {
            kind: 'asset-media',
            tag: 'environment',
            mediaType: 'video',
          },
          required: false,
        },
        placement: 'full-bleed',
        fit: 'cover',
        duration: { kind: 'fixed', frames: CUTAWAY_DURATION_FRAMES },
      },
      // Cutaway 3 — optional before/after as visual proof. Not required; v1's
      // clipGuidance flags this as optional.
      {
        kind: 'media-overlay',
        id: 'cutaway-result',
        clip: {
          source: 'query',
          // Use 'before' as a representative — the v1 service treats
          // before/after as a paired filter, but the slot model resolves one
          // query at a time. Wave-7 backfill can swap to a per-shape strategy
          // if needed.
          query: { kind: 'asset-media', tag: 'before', mediaType: 'video' },
          required: false,
        },
        placement: 'full-bleed',
        fit: 'cover',
        kenBurns: { from: 'center', zoomFrom: 1.0, zoomTo: 1.08 },
        duration: { kind: 'fixed', frames: CUTAWAY_DURATION_FRAMES },
      },
      // Outro end-card — business name + Book Now CTA + logo, pinned to the
      // final ~3s of the master via `start: 'from-end'` (the talking-head
      // spine and cutaways don't tile the full narration-driven master, so a
      // sequential overlay would land mid-video). Mirrors v1 authority-1's
      // outro; a plain generic info-card, brand/CTA filled from slots.
      {
        // v1 authority outro = logo-only on a white card (OutroTagline): a large
        // centred brand logo with an optional tagline below — no business-name
        // headline, no "Book Now" CTA. Built from the generic info-card with a
        // hero logo + optional tagline (brand slot); headline omitted.
        kind: 'info-card',
        id: 'outro',
        layout: 'centered',
        // Tagline below the logo (brand tagline; empty → nothing renders). Small.
        headline: {
          text: {
            source: 'query',
            query: { kind: 'brand', field: 'tagline' },
            required: false,
          },
          style: 'body',
        },
        logo: {
          url: {
            source: 'query',
            query: { kind: 'brand', field: 'logoUrl' },
            required: false,
          },
          position: 'top',
          size: 'hero',
        },
        background: { kind: 'solid', color: '#FFFFFF' },
        entrance: { animation: 'spring-in' },
        duration: { kind: 'fixed', frames: OUTRO_DURATION_FRAMES },
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
      // Lift audio from the spine talking-head clip. The compiler keeps the
      // clip's audio playing continuously even while b-roll cutaways are
      // visually on screen (matches v1 `TalkingHeadLayer`'s audio-continuity
      // architecture).
      narration: { source: 'clip', clipRef: 'base-clip' },
      // Optional background music — gate already allows un-pickable music to
      // pass when the slot is `required: false`.
      music: {
        source: 'query',
        query: { kind: 'music' },
        required: false,
      },
    },
    // Whisper transcribes the lifted clip audio into caption pages.
    captions: { from: 'narration', style: 'caption' },
  },
};
