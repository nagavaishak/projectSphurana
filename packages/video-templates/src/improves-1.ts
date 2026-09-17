import type { TemplateDoc } from './template-doc.js';

// Improves template — v1 organic "improves-1" ported to renderdoc with plain
// generic blocks only (media-track + staggered-list, NO info-card).
//
// V1 (`improves-layer.tsx`) plays a sequence of timed text states synced 1:1 to
// the b-roll clip cuts — one state per clip window:
//   clip 0:     the SERVICE NAME (e.g. "MICRONEEDLING")
//   clip 1..N:  "IMPROVES:" + one benefit item per clip
//   final clip: a closing CTA (e.g. "Start your microneedling journey today")
// Each state quick-fades in/out at its window edges, so exactly ONE state is on
// screen at a time and it swaps on every cut.
//
// This is expressed as a single staggered-list with `reveal: 'sequential'`
// (one element on screen at a time, matching v1's per-clip Sequence windows):
//   • lead   = SERVICE NAME  (script-text role: hook)
//   • items  = benefit beats (script-text role: body), shown one per beat
//   • trail  = closing CTA   (script-text role: cta)
// `stagger.beatsPerItem: 4` mirrors v1's beatsPerEdit: 4 — text changes when the
// underlying clip cuts.
//
// Typography mirrors v1 `baseTextStyle`: Inter (token `heading`/`body`, NOT the
// serif `display`), white, centered, drop shadow `0 2px 14px rgba(0,0,0,0.55)`,
// letterSpacing 0.04em. Service + items are uppercase weight 300, big (96px);
// the CTA is sentence-case weight 400 (64px).
//
// Music only, no scrim (v1 darkens via text-shadow, not an overlay), text_only
// (no narration / captions). `supportsAiVoiceover: false` in v1.
export const improves1: TemplateDoc = {
  id: 'improves-1',
  schemaVersion: 2,
  aspectRatios: ['portrait'],
  // ~12s fallback (service + ~3 items + CTA at one 4-beat clip each). The
  // compiler may drive this from the resolved segment / b-roll clip count.
  duration: { kind: 'fixed', frames: 12 * 30 },
  root: {
    kind: 'leaf',
    id: 'main',
    spine: [
      // Service procedure b-roll fills the frame; `overlay-synced` cuts the
      // scene on every segment (service → each improve → CTA), cycling the
      // uploaded clips — v1's strict 1 segment ↔ 1 clip recycling.
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
        id: 'improves',
        duration: { kind: 'fill' },
        // SERVICE NAME — big uppercase white, weight 300, soft shadow, quick
        // fade (v1 service frame: 96px / 300 / uppercase).
        lead: {
          text: {
            source: 'query',
            query: { kind: 'script-text', role: 'hook' },
            required: true,
          },
          style: 'heading',
          styleOverride: {
            fontSize: 96,
            fontWeight: 300,
            letterSpacing: 0.04,
            textTransform: 'uppercase',
            color: '#FFFFFF',
            textShadow: '0 2px 14px rgba(0,0,0,0.55)',
            strokeWidth: 0,
          },
          entrance: 'fade-in',
        },
        // BENEFIT BEATS — one per clip, uppercase white weight 300 (v1 improve
        // item: 96px / 300 / uppercase), each with the small "IMPROVES:" kicker
        // above it (v1 improvesLabel, 56px / 300 / uppercase).
        items: {
          texts: {
            source: 'query',
            query: { kind: 'script-text', role: 'body' },
            required: true,
          },
          kicker: {
            text: { source: 'fixed', value: 'IMPROVES:' },
            style: 'heading',
            styleOverride: {
              fontSize: 56,
              fontWeight: 300,
              letterSpacing: 0.04,
              textTransform: 'uppercase',
              color: '#FFFFFF',
              textShadow: '0 2px 14px rgba(0,0,0,0.55)',
              strokeWidth: 0,
            },
          },
          style: 'heading',
          styleOverride: {
            fontSize: 96,
            fontWeight: 300,
            letterSpacing: 0.04,
            textTransform: 'uppercase',
            color: '#FFFFFF',
            textShadow: '0 2px 14px rgba(0,0,0,0.55)',
            strokeWidth: 0,
          },
          entrance: 'fade-in',
        },
        // CLOSING CTA — smaller, sentence-case, weight 400 (v1 cta: 64px / 400).
        trail: {
          text: {
            source: 'query',
            query: { kind: 'script-text', role: 'cta' },
            required: true,
          },
          style: 'body',
          styleOverride: {
            fontSize: 64,
            fontWeight: 400,
            letterSpacing: 0.04,
            textTransform: 'none',
            color: '#FFFFFF',
            textShadow: '0 2px 14px rgba(0,0,0,0.55)',
            strokeWidth: 0,
          },
          entrance: 'fade-in',
        },
        // One 4-beat clip window per segment (v1 beatsPerEdit: 4).
        stagger: { beatsPerItem: 4 },
        // Exactly one segment on screen at a time, swapping on each cut — v1's
        // per-clip Sequence windows.
        reveal: 'sequential',
        align: 'center',
        // Centered block, max width ~84% (v1 padding '0 8%').
        placement: { anchor: 'center', x: 0.5, y: 0.5, width: 0.84 },
      },
    ],
  },
  globals: {
    audio: {
      // Music only — v1 is text_only with no AI voiceover support.
      music: {
        source: 'query',
        query: { kind: 'music' },
        required: false,
      },
    },
    // No captions: the on-screen segments carry the message.
  },
};
