import { z } from 'zod';

import {
  animationRef,
  fontRef,
  transitionRef,
  typeStyleRef,
} from './registries/index.js';
import { themeSchema } from './theme.js';

// Helper: a Slot is either a fixed value or a query the synthesizer resolves.
export const slot = <T extends z.ZodTypeAny>(value: T) =>
  z.discriminatedUnion('source', [
    z.object({ source: z.literal('fixed'), value }),
    z.object({
      source: z.literal('query'),
      query: slotQuerySchema,
      required: z.boolean(),
    }),
  ]);

// Asset tag — kept as a free-form string since AssetContentTypeTag is owned by
// @borradh-workspace/labels and we don't want a hard dep on the labels package
// in the schema layer. The gate validates against real tags at synthesis time.
const assetTagSchema = z.string().min(1);

export const slotQuerySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('asset-clips'),
    tag: assetTagSchema,
    count: z.tuple([z.number().int().min(0), z.number().int().min(1)]),
  }),
  z.object({
    kind: z.literal('asset-media'),
    tag: assetTagSchema,
    mediaType: z.enum(['image', 'video']),
  }),
  z.object({
    kind: z.literal('script-text'),
    role: z.enum(['hook', 'body', 'cta', 'disclaimer', 'list']),
    index: z.number().int().min(0).optional(),
  }),
  z.object({
    kind: z.literal('music'),
    mood: z.string().optional(),
    bpm: z.tuple([z.number().min(0), z.number().min(0)]).optional(),
  }),
  z.object({
    kind: z.literal('brand'),
    field: z.enum(['primaryColor', 'logoUrl', 'businessName', 'tagline']),
  }),
]);

// Registry-token Zod schemas are owned by ./registries/*-tokens.ts and
// re-exported from the package barrel. We import them here only so they can
// be used inside this file (in templateMediaTrackSchema etc.); we do NOT
// re-export them or we'd collide with registries/index.ts at the barrel.

export const templateOrientationSchema = z.enum([
  'portrait',
  'landscape',
  'square',
]);

export const blockDurationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed'), frames: z.number().int().min(1) }),
  z.object({ kind: z.literal('content') }),
  z.object({
    kind: z.literal('fill'),
    weight: z.number().min(0).optional(),
  }),
]);

export const templateDurationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed'), frames: z.number().int().min(1) }),
  z.object({ kind: z.literal('driven'), by: z.string().min(1) }),
]);

export const mediaSourceSchema = z.object({
  url: z.string().url(),
  mediaType: z.enum(['video', 'image']),
  trimStartFrames: z.number().int().min(0),
  naturalDurationFrames: z.number().int().min(1).optional(),
});

export const mediaFitSchema = z.enum(['cover', 'contain', 'contain-blur']);

export const mediaCutsSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('beat-synced'),
    beatsPerEdit: z.number().int().min(1).max(16),
  }),
  z.object({ mode: z.literal('even') }),
  z.object({ mode: z.literal('clip-length') }),
  // One clip per statement of a sequential overlay (v1 1 clip ↔ 1 line).
  z.object({ mode: z.literal('overlay-synced') }),
]);

// ── Overlay placement ────────────────────────────────────────────────
// Added by M0 W-F3 so the editor's drag handles have somewhere to write.
// Coordinates are region-relative 0–1; w/h optional (overlay sizes itself if
// omitted). The renderer falls back to a centered default when placement is
// absent so existing templates render unchanged.
export const overlayAnchorSchema = z.enum([
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
]);

export const overlayPlacementSchema = z.object({
  anchor: overlayAnchorSchema,
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1).optional(),
  height: z.number().min(0).max(1).optional(),
});

// ── Spine blocks ─────────────────────────────────────────────────────
export const templateMediaTrackSchema = z.object({
  kind: z.literal('media-track'),
  id: z.string().min(1),
  duration: blockDurationSchema,
  clips: slot(z.array(mediaSourceSchema)),
  fit: mediaFitSchema.optional(),
  cuts: mediaCutsSchema.optional(),
  transition: transitionRef.optional(),
  kenBurnsOnImages: z.boolean().optional(),
  fillMode: z.enum(['loop', 'hold']).optional(),
});

export const templateSolidSchema = z.object({
  kind: z.literal('solid'),
  id: z.string().min(1),
  duration: blockDurationSchema,
  color: slot(z.string().min(1)),
});

export const templateSpineBlockSchema = z.discriminatedUnion('kind', [
  templateMediaTrackSchema,
  templateSolidSchema,
]);

// ── Overlay blocks ───────────────────────────────────────────────────
// Per-element type-style override (v1 parity). Every field optional; set fields
// win over the `style` token's resolved value.
export const typeStyleOverrideSchema = z.object({
  fontSize: z.number().positive().optional(),
  fontWeight: z.number().int().min(100).max(900).optional(),
  letterSpacing: z.number().optional(),
  textTransform: z.enum(['none', 'uppercase']).optional(),
  color: z.string().min(1).optional(),
  colorRole: z
    .enum([
      'primary',
      'secondary',
      'accent',
      'surface',
      'onSurface',
      'onPrimary',
      'muted',
    ])
    .optional(),
  fontStyle: z.enum(['italic', 'normal']).optional(),
  strokeWidth: z.number().min(0).optional(),
  strokeColor: z.string().min(1).optional(),
  textShadow: z.string().min(1).optional(),
  // Per-element font face override (resolved to a family string at Phase B).
  fontRef: fontRef.optional(),
});

const textContainerSchema = z.enum(['none', 'pill', 'button', 'plate']);

const listElementBase = z.object({
  style: typeStyleRef,
  styleOverride: typeStyleOverrideSchema.optional(),
  container: textContainerSchema.optional(),
  entrance: animationRef,
});

// Where an overlay starts on the master timeline (see OverlayStart in
// template-doc). `from-end` anchors the overlay to finish at the master end.
const overlayStartSchema = z.enum(['sequential', 'from-end']);

export const templateStaggeredListSchema = z.object({
  kind: z.literal('staggered-list'),
  id: z.string().min(1),
  duration: blockDurationSchema,
  lead: listElementBase.extend({ text: slot(z.string()) }).optional(),
  items: listElementBase.extend({
    texts: slot(z.array(z.string())),
    // Optional small label rendered above every item (e.g. "IMPROVES:").
    kicker: z
      .object({
        text: slot(z.string()),
        style: typeStyleRef,
        styleOverride: typeStyleOverrideSchema.optional(),
      })
      .optional(),
  }),
  trail: listElementBase.extend({ text: slot(z.string()) }).optional(),
  stagger: z.object({
    // 0 = no stagger (all elements appear together — static "just show" lists).
    beatsPerItem: z.number().int().min(0).max(16),
  }),
  reveal: z.enum(['accumulate', 'sequential']).optional(),
  numbered: z.boolean().optional(),
  align: z.enum(['top', 'center', 'bottom']).optional(),
  hAlign: z.enum(['left', 'center', 'right']).optional(),
  placement: overlayPlacementSchema.optional(),
  start: overlayStartSchema.optional(),
});

// ── text (overlay) ──────────────────────────────────────────────────
export const templateTextSchema = z.object({
  kind: z.literal('text'),
  id: z.string().min(1),
  text: slot(z.string()),
  style: typeStyleRef,
  styleOverride: typeStyleOverrideSchema.optional(),
  animation: z.object({
    entrance: animationRef,
    entranceDurationFrames: z.number().int().min(1).optional(),
    entranceDelayFrames: z.number().int().min(0).optional(),
  }),
  placement: overlayPlacementSchema.optional(),
  duration: blockDurationSchema,
  container: textContainerSchema.optional(),
  start: overlayStartSchema.optional(),
});

// ── media-overlay (overlay) ─────────────────────────────────────────
const mediaOverlayCornerEnum = z.enum(['tl', 'tr', 'bl', 'br']);

const templateMediaOverlayPlacementSchema = z.union([
  z.literal('full-bleed'),
  z.object({
    kind: z.literal('corner'),
    corner: mediaOverlayCornerEnum,
    sizeRatio: z.number().min(0).max(1),
  }),
  z.object({
    kind: z.literal('rect'),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0).max(1),
    h: z.number().min(0).max(1),
  }),
]);

export const templateMediaOverlaySchema = z.object({
  kind: z.literal('media-overlay'),
  id: z.string().min(1),
  clip: slot(mediaSourceSchema),
  placement: templateMediaOverlayPlacementSchema,
  fit: mediaFitSchema,
  kenBurns: z
    .object({
      from: z.enum(['center', 'left', 'right']),
      zoomFrom: z.number().min(0),
      zoomTo: z.number().min(0),
    })
    .optional(),
  label: z
    .object({
      text: slot(z.string()),
      style: typeStyleRef,
      styleOverride: typeStyleOverrideSchema.optional(),
      corner: mediaOverlayCornerEnum,
    })
    .optional(),
  duration: blockDurationSchema,
  start: overlayStartSchema.optional(),
});

// ── info-card (overlay) ─────────────────────────────────────────────
const infoCardBackgroundSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('solid'), color: z.string().min(1) }),
  z.object({
    kind: z.literal('gradient'),
    from: z.string().min(1),
    to: z.string().min(1),
    angle: z.number().optional(),
  }),
]);

export const templateInfoCardSchema = z.object({
  kind: z.literal('info-card'),
  id: z.string().min(1),
  layout: z.enum(['centered', 'left-aligned', 'stacked']),
  headline: z
    .object({ text: slot(z.string()), style: typeStyleRef })
    .optional(),
  items: z
    .object({ texts: slot(z.array(z.string())), style: typeStyleRef })
    .optional(),
  price: z
    .object({
      value: slot(z.string()),
      currency: slot(z.string()),
      style: typeStyleRef,
    })
    .optional(),
  cta: z
    .object({
      text: slot(z.string()),
      url: slot(z.string()).optional(),
      style: typeStyleRef,
    })
    .optional(),
  logo: z
    .object({
      url: slot(z.string()),
      position: z.enum(['top', 'bottom']),
      size: z.enum(['badge', 'hero']).optional(),
    })
    .optional(),
  background: infoCardBackgroundSchema,
  entrance: z.object({
    animation: animationRef,
    entranceDurationFrames: z.number().int().min(1).optional(),
  }),
  duration: blockDurationSchema,
  placement: overlayPlacementSchema.optional(),
  start: overlayStartSchema.optional(),
});

export const templateOverlayBlockSchema = z.discriminatedUnion('kind', [
  templateStaggeredListSchema,
  templateTextSchema,
  templateMediaOverlaySchema,
  templateInfoCardSchema,
]);

// ── Region tree (recursive) ──────────────────────────────────────────
const leafRegionSchema = z.object({
  kind: z.literal('leaf'),
  id: z.string().min(1),
  spine: z.array(templateSpineBlockSchema),
  overlays: z.array(templateOverlayBlockSchema),
});

// `z.lazy` for the recursive split→children→region cycle.
export type TemplateRegionInput =
  | z.infer<typeof leafRegionSchema>
  | {
      kind: 'split';
      axis: 'h' | 'v';
      children: Array<{ ratio: number; region: TemplateRegionInput }>;
    };

export const templateRegionSchema: z.ZodType<TemplateRegionInput> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    leafRegionSchema,
    z.object({
      kind: z.literal('split'),
      axis: z.enum(['h', 'v']),
      children: z.array(
        z.object({
          ratio: z.number().min(0),
          region: templateRegionSchema,
        })
      ),
    }),
  ])
);

// ── Globals ──────────────────────────────────────────────────────────
export const musicSelectionSchema = z.object({
  trackId: z.string().min(1),
  volume: z.number().min(0).max(1),
});

export const narrationConfigSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('tts'),
    fromScript: z.literal(true),
    voice: z.string().optional(),
  }),
  z.object({ source: z.literal('clip'), clipRef: z.string().min(1) }),
]);

export const templateGlobalsSchema = z.object({
  audio: z.object({
    narration: narrationConfigSchema.optional(),
    music: slot(musicSelectionSchema).optional(),
  }),
  captions: z
    .object({ from: z.literal('narration'), style: typeStyleRef })
    .optional(),
});

// ── TemplateDoc root ─────────────────────────────────────────────────
export const templateDocSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(2),
  aspectRatios: z.array(templateOrientationSchema).min(1),
  duration: templateDurationSchema,
  root: templateRegionSchema,
  globals: templateGlobalsSchema,
});

// ═════════════════════════════════════════════════════════════════════
// RenderDoc — Zod mirrors of the resolved shapes in ./render-doc.ts.
//
// These exist alongside the TS interfaces because (a) the worker validates the
// RenderDoc it persists, and (b) the AI-authoring loop in §15.3 wants a
// machine-readable schema to repair against. They are intentionally
// *renderer-agnostic*: no Remotion types here, no asset-aware helpers.
// ═════════════════════════════════════════════════════════════════════

export const renderOrientationSchema = templateOrientationSchema;

export const resolvedDimensionsSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

// ResolvedTypeStyle — Phase B compile-time output. Carries concrete font/size/
// weight/colour values; the renderer never looks up tokens at render time.
export const resolvedTypeStyleSchema = z.object({
  fontFamily: z.string().min(1),
  fontSize: z.number().positive(),
  fontWeight: z.number().int().min(100).max(900),
  letterSpacing: z.number(),
  textTransform: z.enum(['none', 'uppercase']),
  color: z.string().min(1),
  fontStyle: z.enum(['italic', 'normal']).optional(),
  strokeWidth: z.number().min(0).optional(),
  strokeColor: z.string().min(1).optional(),
  textShadow: z.string().min(1).optional(),
});

export const resolvedOverlayPlacementSchema = z.object({
  anchor: overlayAnchorSchema,
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1).optional(),
  height: z.number().min(0).max(1).optional(),
});

export const resolvedMediaClipSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  mediaType: z.enum(['video', 'image']),
  trimStartFrames: z.number().int().min(0),
  naturalDurationFrames: z.number().int().min(1).optional(),
  startFrame: z.number().int().min(0),
  durationInFrames: z.number().int().min(1),
  transition: transitionRef.optional(),
});

export const resolvedTextElementSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  typeStyle: resolvedTypeStyleSchema,
  container: z.enum(['none', 'pill', 'button', 'plate']).optional(),
  entrance: animationRef,
  entranceFrame: z.number().int().min(0),
  entranceDurationFrames: z.number().int().min(1).optional(),
  kicker: z
    .object({ text: z.string(), typeStyle: resolvedTypeStyleSchema })
    .optional(),
});

const resolvedBlockBaseShape = {
  id: z.string().min(1),
  startFrame: z.number().int().min(0),
  durationInFrames: z.number().int().min(1),
};

export const resolvedMediaTrackBlockSchema = z.object({
  kind: z.literal('media-track'),
  ...resolvedBlockBaseShape,
  clips: z.array(resolvedMediaClipSchema),
  fit: mediaFitSchema.optional(),
});

export const resolvedSolidBlockSchema = z.object({
  kind: z.literal('solid'),
  ...resolvedBlockBaseShape,
  color: z.string().min(1),
});

export const resolvedStaggeredListBlockSchema = z.object({
  kind: z.literal('staggered-list'),
  ...resolvedBlockBaseShape,
  lead: resolvedTextElementSchema.optional(),
  items: z.array(resolvedTextElementSchema),
  trail: resolvedTextElementSchema.optional(),
  beatsPerItemFrames: z.number().int().min(1),
  reveal: z.enum(['accumulate', 'sequential']).optional(),
  numbered: z.boolean().optional(),
  hAlign: z.enum(['left', 'center', 'right']).optional(),
  placement: resolvedOverlayPlacementSchema.optional(),
});

export const resolvedTextBlockSchema = z.object({
  kind: z.literal('text'),
  ...resolvedBlockBaseShape,
  text: z.string(),
  typeStyle: resolvedTypeStyleSchema,
  entrance: animationRef,
  entranceDurationFrames: z.number().int().min(1).optional(),
  entranceDelayFrames: z.number().int().min(0).optional(),
  container: z.enum(['none', 'pill', 'button', 'plate']).optional(),
  placement: resolvedOverlayPlacementSchema.optional(),
});

const mediaOverlayCornerSchema = z.enum(['tl', 'tr', 'bl', 'br']);

export const resolvedMediaOverlayPlacementSchema = z.union([
  z.literal('full-bleed'),
  z.object({
    kind: z.literal('corner'),
    corner: mediaOverlayCornerSchema,
    sizeRatio: z.number().min(0).max(1),
  }),
  z.object({
    kind: z.literal('rect'),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0).max(1),
    h: z.number().min(0).max(1),
  }),
]);

export const resolvedMediaOverlayKenBurnsSchema = z.object({
  from: z.enum(['center', 'left', 'right']),
  zoomFrom: z.number().min(0),
  zoomTo: z.number().min(0),
});

export const resolvedMediaOverlayLabelSchema = z.object({
  text: z.string(),
  typeStyle: resolvedTypeStyleSchema,
  corner: mediaOverlayCornerSchema,
});

export const resolvedMediaOverlayBlockSchema = z.object({
  kind: z.literal('media-overlay'),
  ...resolvedBlockBaseShape,
  clip: resolvedMediaClipSchema,
  placement: resolvedMediaOverlayPlacementSchema,
  fit: z.enum(['cover', 'contain', 'contain-blur']),
  kenBurns: resolvedMediaOverlayKenBurnsSchema.optional(),
  label: resolvedMediaOverlayLabelSchema.optional(),
});

export const resolvedInfoCardLayoutSchema = z.enum([
  'centered',
  'left-aligned',
  'stacked',
]);

export const resolvedInfoCardBackgroundSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('solid'), color: z.string().min(1) }),
  z.object({
    kind: z.literal('gradient'),
    from: z.string().min(1),
    to: z.string().min(1),
    angle: z.number().optional(),
  }),
]);

export const resolvedInfoCardBlockSchema = z.object({
  kind: z.literal('info-card'),
  ...resolvedBlockBaseShape,
  layout: resolvedInfoCardLayoutSchema,
  headline: z
    .object({ text: z.string(), typeStyle: resolvedTypeStyleSchema })
    .optional(),
  items: z
    .object({
      texts: z.array(z.string()),
      typeStyle: resolvedTypeStyleSchema,
    })
    .optional(),
  price: z
    .object({
      value: z.string(),
      currency: z.string(),
      typeStyle: resolvedTypeStyleSchema,
    })
    .optional(),
  cta: z
    .object({
      text: z.string(),
      url: z.string().optional(),
      typeStyle: resolvedTypeStyleSchema,
    })
    .optional(),
  logo: z
    .object({
      url: z.string().min(1),
      position: z.enum(['top', 'bottom']),
      size: z.enum(['badge', 'hero']).optional(),
    })
    .optional(),
  background: resolvedInfoCardBackgroundSchema,
  accent: z
    .object({ color: z.string().min(1), onColor: z.string().min(1) })
    .optional(),
  entrance: animationRef,
  entranceDurationFrames: z.number().int().min(1).optional(),
  placement: resolvedOverlayPlacementSchema.optional(),
});

export const resolvedBlockSchema = z.discriminatedUnion('kind', [
  resolvedMediaTrackBlockSchema,
  resolvedSolidBlockSchema,
  resolvedStaggeredListBlockSchema,
  resolvedTextBlockSchema,
  resolvedMediaOverlayBlockSchema,
  resolvedInfoCardBlockSchema,
]);

// Recursive Resolved region tree — same shape rules as TemplateRegion.
const resolvedLeafRegionSchema = z.object({
  kind: z.literal('leaf'),
  id: z.string().min(1),
  spine: z.array(resolvedBlockSchema),
  overlays: z.array(resolvedBlockSchema),
});

export type ResolvedRegionInput =
  | z.infer<typeof resolvedLeafRegionSchema>
  | {
      kind: 'split';
      axis: 'h' | 'v';
      children: Array<{ ratio: number; region: ResolvedRegionInput }>;
    };

export const resolvedRegionSchema: z.ZodType<ResolvedRegionInput> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    resolvedLeafRegionSchema,
    z.object({
      kind: z.literal('split'),
      axis: z.enum(['h', 'v']),
      children: z.array(
        z.object({
          ratio: z.number().min(0),
          region: resolvedRegionSchema,
        })
      ),
    }),
  ])
);

export const resolvedMusicTrackSchema = z.object({
  trackId: z.string().min(1),
  url: z.string().min(1),
  volume: z.number().min(0).max(1),
  bpm: z.number().min(0).optional(),
});

export const resolvedNarrationSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('tts'),
    url: z.string().min(1),
    startFrame: z.number().int().min(0),
    durationInFrames: z.number().int().min(1),
    volume: z.number().min(0).max(1).optional(),
  }),
  z.object({
    source: z.literal('clip'),
    clipRef: z.string().min(1),
    lift: z.literal(true),
  }),
]);

export const resolvedCaptionsPageSchema = z.object({
  fromFrame: z.number().int().min(0),
  toFrame: z.number().int().min(0),
  text: z.string(),
  typeStyle: resolvedTypeStyleSchema,
});

export const resolvedCaptionsSchema = z.object({
  pages: z.array(resolvedCaptionsPageSchema),
  typeStyle: resolvedTypeStyleSchema,
});

export const renderDocSchema = z.object({
  schemaVersion: z.literal(2),
  videoId: z.string().min(1),
  templateDocId: z.string().min(1),
  fps: z.number().int().positive(),
  dimensions: resolvedDimensionsSchema,
  durationInFrames: z.number().int().min(1),
  orientation: renderOrientationSchema,
  root: resolvedRegionSchema,
  globals: z.object({
    audio: z.object({
      music: resolvedMusicTrackSchema.optional(),
      narration: resolvedNarrationSchema.optional(),
    }),
    captions: resolvedCaptionsSchema.optional(),
    theme: themeSchema.optional(),
  }),
});
