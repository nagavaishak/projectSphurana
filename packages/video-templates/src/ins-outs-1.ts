import type { TemplateDoc } from './template-doc.js';

// ins-outs-1 — "INS + OUTS" (organic, v1 port)
//
// Faithful renderdoc port of the v1 InsOutsLayer
// (packages/remotion/src/components/ins-outs-layer.tsx), built entirely from
// plain generic blocks (media-track, solid, text, staggered-list — NO
// info-card).
//
// v1 design (top → bottom, all white, Inter sans, centered, single-line items
// that auto-shrink horizontally over a darkened b-roll):
//   - TITLE          bold uppercase, fontSize 54, weight 800
//   - "INS" label    bold uppercase, fontSize 54, weight 800
//   - INS items      fontSize 46, weight 500
//   - "OUTS" label   bold uppercase, fontSize 54, weight 800
//   - OUTS items     fontSize 46, weight 500
//   - dark scrim rgba(0,0,0,0.35) for legibility (v1 InsOutsLayer scrim)
//   - drop shadow on all text: 0 2px 14px rgba(0,0,0,0.5)
//   - Music only, text_only (no narration, no captions).
//
// ─── DATA SPLIT (INS vs OUTS) ───────────────────────────────────────────────
// ins-outs needs two distinct item lists. It uses the generic multi-list slot
// role 'list' (script-text role: 'list', index N), so the script produces a
// `lists` array — lists[0] = INS, lists[1] = OUTS. No role is overloaded.
//   - title      → script-text role 'hook'
//   - INS items  → script-text role 'list', index 0
//   - OUTS items → script-text role 'list', index 1
// The static "INS" / "OUTS" section headers are fixed-value `lead` text on each
// staggered-list (literal labels in v1, never data). Per-list copy guidance
// lives in script-prompt's TEMPLATE_LIST_GUIDANCE['ins-outs-1'].

const FPS = 30;
// Fallback length only (music-only template, no narration to drive it).
const TOTAL_FRAMES = 12 * FPS;

// Shared v1 drop shadow for legibility over footage.
const TEXT_SHADOW = '0 2px 14px rgba(0,0,0,0.5)';

// v1 sizes.
const TITLE_FONT_SIZE = 54;
const LABEL_FONT_SIZE = 54;
const ITEM_FONT_SIZE = 46;

export const insOuts1: TemplateDoc = {
  id: 'ins-outs-1',
  schemaVersion: 2,
  aspectRatios: ['portrait'],
  duration: { kind: 'fixed', frames: TOTAL_FRAMES },
  root: {
    kind: 'leaf',
    id: 'main',
    spine: [
      // Procedure b-roll fills the frame; beat-synced cuts (v1 beatsPerEdit 4),
      // looped to length.
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
        fillMode: 'loop',
      },
      // Dark scrim over the b-roll (v1 InsOutsLayer scrim rgba(0,0,0,0.35)).
      // The spine paints in order, so this sits above the media-track and below
      // the overlays.
      {
        kind: 'solid',
        id: 'scrim',
        duration: { kind: 'fill' },
        color: { source: 'fixed', value: 'rgba(0,0,0,0.35)' },
      },
    ],
    overlays: [
      // TITLE — bold uppercase white, drop shadow, fades in, holds for the clip.
      // Pinned near the top (v1 stacks it first, ~12% from top after padding).
      {
        kind: 'text',
        id: 'title',
        text: {
          source: 'query',
          query: { kind: 'script-text', role: 'hook' },
          required: true,
        },
        style: 'heading',
        styleOverride: {
          fontSize: TITLE_FONT_SIZE,
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: 0.02,
          color: '#FFFFFF',
          textShadow: TEXT_SHADOW,
          strokeWidth: 0,
        },
        // v1 is static — the whole card just shows, no entrance.
        animation: { entrance: 'none' },
        placement: { anchor: 'top', x: 0.5, y: 0.05, width: 0.88 },
        duration: { kind: 'fill' },
        container: 'none',
      },
      // INS section — "INS" label (fixed) + INS items (script-text 'body').
      // Sits in the upper-middle band of the frame.
      {
        kind: 'staggered-list',
        id: 'ins',
        duration: { kind: 'fill' },
        // Section header — static literal label (v1 insLabel default "INS"),
        // bold uppercase, matching the title weight/size.
        lead: {
          text: { source: 'fixed', value: 'INS' },
          style: 'heading',
          styleOverride: {
            fontSize: LABEL_FONT_SIZE,
            fontWeight: 800,
            textTransform: 'uppercase',
            color: '#FFFFFF',
            textShadow: TEXT_SHADOW,
            strokeWidth: 0,
          },
          entrance: 'none',
        },
        // INS items — white, weight 500, slide-up entrance, accumulate.
        items: {
          texts: {
            source: 'query',
            query: { kind: 'script-text', role: 'list', index: 0 },
            required: true,
          },
          style: 'body',
          styleOverride: {
            fontSize: ITEM_FONT_SIZE,
            fontWeight: 500,
            textTransform: 'none',
            color: '#FFFFFF',
            textShadow: TEXT_SHADOW,
            strokeWidth: 0,
          },
          entrance: 'none',
        },
        stagger: { beatsPerItem: 0 },
        reveal: 'accumulate',
        align: 'top',
        // Top-anchored so the label + items read as one tight group below the
        // title (v1 stacks INS directly under the title).
        placement: { anchor: 'top', x: 0.5, y: 0.16, width: 0.9 },
      },
      // OUTS section — "OUTS" label (fixed) + OUTS items (script-text
      // 'disclaimer', repurposed as the 2nd list). Sits in the lower band.
      {
        kind: 'staggered-list',
        id: 'outs',
        duration: { kind: 'fill' },
        lead: {
          text: { source: 'fixed', value: 'OUTS' },
          style: 'heading',
          styleOverride: {
            fontSize: LABEL_FONT_SIZE,
            fontWeight: 800,
            textTransform: 'uppercase',
            color: '#FFFFFF',
            textShadow: TEXT_SHADOW,
            strokeWidth: 0,
          },
          entrance: 'none',
        },
        items: {
          texts: {
            source: 'query',
            query: { kind: 'script-text', role: 'list', index: 1 },
            required: true,
          },
          style: 'body',
          styleOverride: {
            fontSize: ITEM_FONT_SIZE,
            fontWeight: 500,
            textTransform: 'none',
            color: '#FFFFFF',
            textShadow: TEXT_SHADOW,
            strokeWidth: 0,
          },
          entrance: 'none',
        },
        stagger: { beatsPerItem: 0 },
        reveal: 'accumulate',
        align: 'top',
        // Second group below INS (v1 OUTS sits under the INS block).
        placement: { anchor: 'top', x: 0.5, y: 0.45, width: 0.9 },
      },
    ],
  },
  globals: {
    audio: {
      // Music only — no narration (v1 narrationMode: text_only).
      music: {
        source: 'query',
        query: { kind: 'music' },
        required: false,
      },
    },
  },
};
