import type { TemplateDoc } from './template-doc.js';

// Time-lapse Progress — the "watch it work over time" format (e.g. linnacheung7
// "0h → 4.5h", 8.5M views). A big timestamp progression ("Day 1 → Day 30")
// held over the footage as it changes from before to after, plus a short
// caption. Ideal for treatment results (Botox settling, skin clearing, filler
// over weeks).
//
// Built from existing generic blocks (media-track before→after clips + two text
// overlays): renders through the generic renderdoc compiler, no new Remotion
// layer. The "→" is plain text.
const FPS = 30;
const TOTAL_FRAMES = 10 * FPS;

export const timeProgress1: TemplateDoc = {
  id: 'time-progress-1',
  schemaVersion: 2,
  aspectRatios: ['portrait'],
  duration: { kind: 'fixed', frames: TOTAL_FRAMES },
  root: {
    kind: 'leaf',
    id: 'main',
    spine: [
      // Before → after footage, one clip each, cut on the beat so the subject
      // visibly changes across the timestamp.
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
        cuts: { mode: 'beat-synced', beatsPerEdit: 4 },
        fillMode: 'loop',
      },
      // Subtle top/bottom scrim band for legibility.
      {
        kind: 'solid',
        id: 'scrim',
        duration: { kind: 'fill' },
        color: { source: 'fixed', value: 'rgba(0,0,0,0.22)' },
      },
    ],
    overlays: [
      // The timestamp progression — the hero (e.g. "Day 1 → Day 30"). Bold,
      // black fill on white stroke so it reads over any footage.
      {
        kind: 'text',
        id: 'timestamp',
        text: {
          source: 'query',
          query: { kind: 'script-text', role: 'hook' },
          required: true,
        },
        style: 'heading',
        styleOverride: {
          fontSize: 76,
          fontWeight: 800,
          textTransform: 'none',
          color: '#FFFFFF',
          strokeColor: '#000000',
          strokeWidth: 3,
          textShadow: '0 3px 18px rgba(0,0,0,0.5)',
        },
        animation: { entrance: 'fade-in', entranceDurationFrames: 12 },
        placement: { anchor: 'center', x: 0.5, y: 0.42, width: 0.9 },
        duration: { kind: 'fill' },
        container: 'none',
      },
      // A short caption naming what changed. Holds under the timestamp.
      {
        kind: 'text',
        id: 'caption',
        text: {
          source: 'query',
          query: { kind: 'script-text', role: 'cta' },
          required: true,
        },
        style: 'heading',
        styleOverride: {
          fontSize: 40,
          fontWeight: 600,
          textTransform: 'none',
          color: '#FFFFFF',
          textShadow: '0 2px 14px rgba(0,0,0,0.6)',
          strokeWidth: 0,
        },
        animation: {
          entrance: 'fade-in',
          entranceDurationFrames: 12,
          entranceDelayFrames: 18,
        },
        placement: { anchor: 'center', x: 0.5, y: 0.56, width: 0.84 },
        duration: { kind: 'fill' },
        container: 'none',
      },
    ],
  },
  globals: {
    audio: {
      music: { source: 'query', query: { kind: 'music' }, required: false },
    },
  },
};
