// Offer-square-1 — Shape E port (split-h: media-track | info-card).
//
// Mirrors v1 `offer-square-1` ("Square Offer") in
// packages/features/src/videos/templates/template-definitions.ts:438-474:
//
//   "Side-by-side 1080x1080 layout — procedure footage on the left, offer
//    card on the right. Music-driven with fast cuts."
//
// Shape E per the design doc Appendix:
//   `split-h` region:  media-track | info-card
//   `audio.music`      (no narration, no captions)
//
// This is the ONLY wave-6 template that exercises the recursive region tree
// (§4) — wave-1's TemplateRenderer.tsx walks `split → children → region`
// and `Split` lays children out with `flexDirection: row` for axis='h'.
// Verified in /packages/remotion/src/components/template-renderer.tsx
// (lines 84-114). All other shapes in this branch (educational-1,
// authority-1) use a single `leaf`.
//
// ── Aspect-ratio decision ───────────────────────────────────────────
// The TemplateOrientation enum supports 'square', so we declare ['square']
// directly. The renderer's wave-1 register-composition pass mounts both
// portrait and square sizings (see Root.tsx); the compiler picks the matching
// dimensions per orientation. The v1 SquareOfferComposition was 1080×1080.
//
// ── price + currency gaps ───────────────────────────────────────────
// Per the punch list and slot.ts, the `script-text` role enum does NOT
// include 'price' and the `brand` field enum does NOT include 'currency'.
// Both are wave-5 schema changes that the brief flags as out-of-scope for
// us. Workaround:
//   - `price.value`     : `fixed` placeholder string, overridden per-video by
//                         the converter via `frozenOfferContent.price`
//   - `price.currency`  : `fixed` 'USD' placeholder; converter passes through
//                         the v1 draftConfig's `currencyCode` so wave-7
//                         backfill can replay the original currency
// TODO(wave-7): add a `brand` slot field for `currency` and a `script-text`
// role for `price` so per-video values can come from the resolver rather
// than the converter.
//
// ── Duration ────────────────────────────────────────────────────────
// V1 hardcodes 20s for offer-square-1 (see apps/video-worker/src/main.ts
// "switch (variationId) { case 'offer-square-1': totalDurationSec = 20; }").
// At 30fps that's 600 frames. No narration here, so we use `fixed` rather
// than `driven by 'narration'`.

import type { TemplateDoc } from './template-doc.js';

const FPS = 30;
const TOTAL_FRAMES = 20 * FPS; // 20 s, mirrors v1 default for offer-square-1.

export const offerSquare1: TemplateDoc = {
  id: 'offer-square-1',
  schemaVersion: 2,
  aspectRatios: ['square'],
  duration: { kind: 'fixed', frames: TOTAL_FRAMES },
  root: {
    kind: 'split',
    axis: 'h',
    // v1 used 3/5 + 2/5 (648px + 432px on a 1080 canvas). Preserve that
    // ratio so the converter's compile pass produces the same proportions.
    children: [
      // Left pane — procedure b-roll, fast cuts driven by music beat.
      {
        ratio: 3,
        region: {
          kind: 'leaf',
          id: 'media-pane',
          spine: [
            {
              kind: 'media-track',
              id: 'broll',
              duration: { kind: 'fill' },
              clips: {
                source: 'query',
                query: {
                  kind: 'asset-clips',
                  // v1 used `procedure` for offer footage (see template-
                  // definitions.ts variation clipGuidance). The v1 hint
                  // says "AI will cut clips to the beat".
                  tag: 'procedure',
                  // v1 recommendedClipCount: 3, maxBRollClips: 4.
                  count: [1, 4],
                },
                required: true,
              },
              fit: 'cover',
              cuts: { mode: 'beat-synced', beatsPerEdit: 2 },
              transition: 'cut',
              kenBurnsOnImages: true,
              fillMode: 'loop',
            },
          ],
          overlays: [],
        },
      },
      // Right pane — solid background + info-card overlay.
      {
        ratio: 2,
        region: {
          kind: 'leaf',
          id: 'card-pane',
          spine: [
            {
              kind: 'solid',
              id: 'card-bg',
              duration: { kind: 'fill' },
              // White-pane background matches v1 `SquareOfferPane`
              // (#FFFFFF). The converter swaps this for brand surface
              // colour when a brand-kit theme is present.
              color: { source: 'fixed', value: '#FFFFFF' },
            },
          ],
          overlays: [
            {
              kind: 'info-card',
              id: 'offer-card',
              // Left-aligned benefit list (v1 SquareOfferPane), not a centred
              // block — headline + checkmark bullets read top-down, CTA pinned
              // to the bottom of the pane by the renderer.
              layout: 'left-aligned',
              headline: {
                text: {
                  source: 'query',
                  query: { kind: 'script-text', role: 'hook' },
                  required: true,
                },
                style: 'display',
              },
              items: {
                texts: {
                  source: 'query',
                  query: { kind: 'script-text', role: 'body' },
                  required: false,
                },
                style: 'body',
              },
              // Price — `script-text role: 'price'` does not exist in the
              // current Slot enum (see slot.ts). Until wave-7 adds it,
              // converter overrides this `fixed` placeholder.
              price: {
                value: { source: 'fixed', value: '' },
                // Brand currency slot field doesn't exist either. Fall back
                // to fixed 'USD'; converter passes the per-video currency
                // through `frozenOfferContent.currency` instead.
                currency: { source: 'fixed', value: 'USD' },
                style: 'heading',
              },
              cta: {
                text: {
                  source: 'query',
                  query: { kind: 'script-text', role: 'cta' },
                  required: true,
                },
                style: 'heading',
              },
              logo: {
                url: {
                  source: 'query',
                  query: { kind: 'brand', field: 'logoUrl' },
                  required: false,
                },
                position: 'top',
              },
              // The card paints its own white pane (rather than relying only on
              // the solid spine + a transparent card) so the renderer can pick
              // dark-on-light text colours that contrast with it — v1's white
              // offer pane with brand-coloured headline + bullets.
              background: { kind: 'solid', color: '#FFFFFF' },
              entrance: { animation: 'spring-in' },
              duration: { kind: 'fill' },
              placement: {
                anchor: 'center',
                x: 0.5,
                y: 0.5,
                width: 0.84,
                height: 0.86,
              },
            },
          ],
        },
      },
    ],
  },
  globals: {
    audio: {
      // No narration on offer-square-1 (v1 narrationMode: 'text_only').
      // Background music drives the cut cadence on the media pane.
      music: {
        source: 'query',
        query: { kind: 'music', mood: 'energetic', bpm: [100, 130] },
        required: false,
      },
    },
    // No captions — offer videos are music-only, no narration to transcribe.
  },
};
