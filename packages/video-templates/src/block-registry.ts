// Block registry — one BlockDef per block kind.
//
// Per §12, the renderer and the synthesizer/compiler dispatch on `kind`
// against this registry. Adding a new block is:
//   1. Add the kind here with its doc + resolved Zod schemas.
//   2. Register a renderer (BlockRenderer) in @borradh-workspace/remotion.
//   3. Update the compiler to emit the resolved shape.
//
// The two ends are validated independently — Zod runs against authored
// TemplateDocs (Phase A) and against compiled RenderDocs (worker handoff).

import type { z } from 'zod';

import type { BlockDef, ComputeContentDurationCtx } from './block-def.js';
import {
  resolvedInfoCardBlockSchema,
  resolvedMediaOverlayBlockSchema,
  resolvedMediaTrackBlockSchema,
  resolvedSolidBlockSchema,
  resolvedStaggeredListBlockSchema,
  resolvedTextBlockSchema,
  templateInfoCardSchema,
  templateMediaOverlaySchema,
  templateMediaTrackSchema,
  templateSolidSchema,
  templateStaggeredListSchema,
  templateTextSchema,
} from './schemas.js';
import type {
  TemplateInfoCard,
  TemplateMediaOverlay,
  TemplateMediaTrack,
  TemplateSolid,
  TemplateStaggeredList,
  TemplateText,
} from './template-doc.js';

// ── media-track ─────────────────────────────────────────────────────

const mediaTrackBlockDef: BlockDef<
  TemplateMediaTrack,
  z.infer<typeof resolvedMediaTrackBlockSchema>
> = {
  kind: 'media-track',
  category: 'spine',
  docSchema: templateMediaTrackSchema as z.ZodType<TemplateMediaTrack>,
  resolvedSchema: resolvedMediaTrackBlockSchema,
  // media-track doesn't drive `content` length — its clips are sized to the
  // resolved length of the block.
};

// ── solid ───────────────────────────────────────────────────────────

const solidBlockDef: BlockDef<
  TemplateSolid,
  z.infer<typeof resolvedSolidBlockSchema>
> = {
  kind: 'solid',
  category: 'spine',
  docSchema: templateSolidSchema as z.ZodType<TemplateSolid>,
  resolvedSchema: resolvedSolidBlockSchema,
};

// ── staggered-list ──────────────────────────────────────────────────

const staggeredListBlockDef: BlockDef<
  TemplateStaggeredList,
  z.infer<typeof resolvedStaggeredListBlockSchema>
> = {
  kind: 'staggered-list',
  category: 'overlay',
  docSchema: templateStaggeredListSchema as z.ZodType<TemplateStaggeredList>,
  resolvedSchema: resolvedStaggeredListBlockSchema,
  computeContentDuration: (
    params: TemplateStaggeredList,
    ctx: ComputeContentDurationCtx
  ) => {
    // beats-per-item × (lead? + items + trail? + 1 tail beat) × fps × secPerBeat.
    // We don't know item count from params alone (items.texts may be a query);
    // callers that need a concrete number resolve the slot first and supply
    // resolvedItemCount via ctx. Without a count or BPM, return undefined so
    // the resolver demands an explicit contentDurationOverrides entry.
    const itemCount = ctx.resolvedItemCount;
    if (itemCount === undefined || ctx.musicBpm === undefined) return undefined;

    const secPerBeat = 60 / ctx.musicBpm;
    const framesPerBeat = secPerBeat * ctx.fps;
    const framesPerItem = framesPerBeat * params.stagger.beatsPerItem;

    const leadCount = params.lead ? 1 : 0;
    const trailCount = params.trail ? 1 : 0;
    // +1 tail beat so the last element has time to settle before block ends.
    const totalElements = leadCount + itemCount + trailCount + 1;
    return Math.round(totalElements * framesPerItem);
  },
};

// ── text ────────────────────────────────────────────────────────────

const textBlockDef: BlockDef<
  TemplateText,
  z.infer<typeof resolvedTextBlockSchema>
> = {
  kind: 'text',
  category: 'overlay',
  docSchema: templateTextSchema as z.ZodType<TemplateText>,
  resolvedSchema: resolvedTextBlockSchema,
  // text duration is generally author-driven; only typewriter-style entrances
  // could derive a meaningful content length, and the synthesizer supplies the
  // resolved string itself, so we return undefined here.
  computeContentDuration: (params, ctx) => {
    void params;
    void ctx;
    return undefined;
  },
};

// ── media-overlay ───────────────────────────────────────────────────

const mediaOverlayBlockDef: BlockDef<
  TemplateMediaOverlay,
  z.infer<typeof resolvedMediaOverlayBlockSchema>
> = {
  kind: 'media-overlay',
  category: 'overlay',
  docSchema: templateMediaOverlaySchema as z.ZodType<TemplateMediaOverlay>,
  resolvedSchema: resolvedMediaOverlayBlockSchema,
};

// ── info-card ───────────────────────────────────────────────────────

const infoCardBlockDef: BlockDef<
  TemplateInfoCard,
  z.infer<typeof resolvedInfoCardBlockSchema>
> = {
  kind: 'info-card',
  category: 'overlay',
  docSchema: templateInfoCardSchema as z.ZodType<TemplateInfoCard>,
  resolvedSchema: resolvedInfoCardBlockSchema,
};

// ── Registry ────────────────────────────────────────────────────────

export const blockRegistry: Record<string, BlockDef> = {
  'media-track': mediaTrackBlockDef,
  solid: solidBlockDef,
  'staggered-list': staggeredListBlockDef,
  text: textBlockDef,
  'media-overlay': mediaOverlayBlockDef,
  'info-card': infoCardBlockDef,
};

export function getBlockDef(kind: string): BlockDef | undefined {
  return blockRegistry[kind];
}
