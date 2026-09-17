import type { TemplateDoc } from './template-doc.js';

// Step + Timer — the save-worthy routine/protocol format seen across skincare
// reels (e.g. "Sheet Mask ⏱ 10-20 min", GRWM "in N steps"). A bold title, then
// numbered timed steps that reveal one per clip over a darkened procedure
// b-roll. Each step line carries its own duration (baked into the copy, e.g.
// "Cleanse — 60 sec"), so no bespoke timer-pill component is needed.
//
// Built from existing generic blocks (media-track + solid scrim +
// staggered-list with numbered badges): renders through the generic renderdoc
// compiler, no new Remotion layer.
export const stepTimer1: TemplateDoc = {
  id: 'step-timer-1',
  schemaVersion: 2,
  aspectRatios: ['portrait'],
  // Driven by the steps list so length scales with step count.
  duration: { kind: 'driven', by: 'steps' },
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
          query: { kind: 'asset-clips', tag: 'procedure', count: [1, 4] },
          required: true,
        },
        fit: 'cover',
        cuts: { mode: 'overlay-synced' },
        fillMode: 'loop',
      },
      // Dark scrim so the timed steps stay legible over footage.
      {
        kind: 'solid',
        id: 'scrim',
        duration: { kind: 'fill' },
        color: { source: 'fixed', value: 'rgba(0,0,0,0.42)' },
      },
    ],
    overlays: [
      {
        kind: 'staggered-list',
        id: 'steps',
        // `content` so the driven master ({by:'steps'}) can size against it.
        duration: { kind: 'content' },
        // Bold uppercase title (e.g. "YOUR 4-STEP GLOW ROUTINE").
        lead: {
          text: {
            source: 'query',
            query: { kind: 'script-text', role: 'hook' },
            required: true,
          },
          style: 'heading',
          styleOverride: {
            fontSize: 54,
            fontWeight: 800,
            textTransform: 'uppercase',
            color: '#FFFFFF',
            textShadow: '0 2px 12px rgba(0,0,0,0.5)',
            strokeWidth: 0,
          },
          entrance: 'fade-in',
        },
        // Timed steps — each "Step name — duration", revealed one per clip with
        // a numbered badge drawn by the renderer.
        items: {
          texts: {
            source: 'query',
            query: { kind: 'script-text', role: 'body' },
            required: true,
          },
          style: 'heading',
          styleOverride: {
            fontSize: 40,
            fontWeight: 600,
            textTransform: 'none',
            color: '#FFFFFF',
            textShadow: '0 2px 10px rgba(0,0,0,0.5)',
            strokeWidth: 0,
          },
          entrance: 'fade-in',
        },
        // One step per clip window, revealed sequentially.
        stagger: { beatsPerItem: 4 },
        reveal: 'sequential',
        numbered: true,
        align: 'center',
        hAlign: 'left',
        placement: { anchor: 'center', x: 0.5, y: 0.5, width: 0.84 },
      },
    ],
  },
  globals: {
    audio: {
      music: { source: 'query', query: { kind: 'music' }, required: false },
    },
  },
};
