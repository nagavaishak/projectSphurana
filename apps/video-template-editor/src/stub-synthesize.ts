import {
  type BlockDuration,
  type MediaSource,
  type MusicSelection,
  type RenderDoc,
  type RenderOrientation,
  type ResolvedBlock,
  type ResolvedMediaClip,
  type ResolvedMediaTrackBlock,
  type ResolvedMusicTrack,
  type ResolvedOverlayPlacement,
  type ResolvedRegion,
  type ResolvedStaggeredListBlock,
  type ResolvedTextElement,
  SHARED_MUSIC_TRACKS,
  type Slot,
  type SlotQuery,
  type TemplateDoc,
  type TemplateDuration,
  type TemplateMediaTrack,
  type TemplateOverlayBlock,
  type TemplateRegion,
  type TemplateSolid,
  type TemplateSpineBlock,
  type TemplateStaggeredList,
  engineDefaultTheme,
  getMusicTrackById,
  getTypeStyle,
} from '@borradh-workspace/video-templates';

import type { PreviewContext } from './fixtures/preview-context.js';

// In-browser stub synthesis: TemplateDoc + PreviewContext → RenderDoc.
//
// Mirrors what the worker-side compiler does, but resolves slot queries
// against the fixture preview context instead of real org/asset data.
//
// As of wave-1 (P0.2/0.3/0.4), the renderer is region-aware (recursive leaf
// + split, dispatched via the block registry). We resolve the full region
// tree here so editor previews exercise the same path the production
// compiler will.

const FPS = 30;

const DIMENSIONS_BY_ORIENTATION: Record<
  RenderOrientation,
  { width: number; height: number }
> = {
  portrait: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 },
};

export type StubRenderDoc = RenderDoc;

export type StubSynthesizeResult =
  | { ok: true; renderDoc: StubRenderDoc }
  | { ok: false; error: string };

// ─── Slot resolvers ──────────────────────────────────────────────────────

function resolveSlot<T>(
  slot: Slot<T>,
  resolveQuery: (query: SlotQuery) => T | undefined
): T | undefined {
  if (slot.source === 'fixed') return slot.value;
  const resolved = resolveQuery(slot.query);
  if (resolved === undefined && slot.required) return undefined;
  return resolved;
}

function makeMediaSource(url: string): MediaSource {
  const isImage = /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url);
  return {
    url,
    mediaType: isImage ? 'image' : 'video',
    trimStartFrames: 0,
    // Stubbed natural duration so per-clip distribution works even before any
    // real ffprobe / metadata is available.
    naturalDurationFrames: isImage ? FPS * 5 : FPS * 5,
  };
}

function buildSlotResolver<T>(
  ctx: PreviewContext,
  kindHint: 'clips' | 'media' | 'script' | 'music' | 'brand'
): (query: SlotQuery) => T | undefined {
  return (query) => {
    switch (query.kind) {
      case 'asset-clips': {
        if (kindHint !== 'clips') return undefined;
        const [, max] = query.count;
        const take = Math.min(Math.max(1, max), ctx.clipUrls.length);
        return ctx.clipUrls.slice(0, take).map(makeMediaSource) as unknown as T;
      }
      case 'asset-media': {
        if (kindHint !== 'media') return undefined;
        const url =
          query.mediaType === 'image'
            ? (ctx.imageUrls[0] ?? ctx.clipUrls[0])
            : (ctx.clipUrls[0] ?? ctx.imageUrls[0]);
        if (!url) return undefined;
        return makeMediaSource(url) as unknown as T;
      }
      case 'script-text': {
        if (kindHint !== 'script') return undefined;
        const lines = ctx.script
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length === 0) return '' as unknown as T;
        switch (query.role) {
          case 'hook':
            return (lines[0] ?? '') as unknown as T;
          case 'cta':
            return (lines.at(-1) ?? '') as unknown as T;
          case 'body': {
            const body = lines.slice(1, -1);
            const arr = body.length > 0 ? body : lines;
            // body slots come in two flavours: single string (lead/trail) and
            // string[] (items). We return string[] here; the caller picks the
            // right shape via the surrounding code path.
            return arr as unknown as T;
          }
          case 'disclaimer':
            return '' as unknown as T;
        }
        return undefined;
      }
      case 'music': {
        if (kindHint !== 'music') return undefined;
        const track =
          getMusicTrackById(ctx.musicTrackId) ?? SHARED_MUSIC_TRACKS[0];
        if (!track) return undefined;
        return {
          trackId: track.id,
          volume: ctx.musicVolume,
        } as unknown as T;
      }
      case 'brand': {
        if (kindHint !== 'brand') return undefined;
        return ctx.brand[query.field] as unknown as T;
      }
    }
  };
}

// ─── Scene synthesis for media-track ─────────────────────────────────────

function distributeClips(
  clips: MediaSource[],
  startFrame: number,
  totalFrames: number
): ResolvedMediaClip[] {
  if (clips.length === 0) return [];
  const per = Math.max(1, Math.floor(totalFrames / clips.length));
  const out: ResolvedMediaClip[] = [];
  let cursor = 0;
  for (let i = 0; i < clips.length; i++) {
    const isLast = i === clips.length - 1;
    const dur = isLast ? totalFrames - cursor : per;
    const clip = clips[i];
    if (!clip) continue;
    out.push({
      id: `${i}-${clip.url}`,
      url: clip.url,
      mediaType: clip.mediaType,
      trimStartFrames: clip.trimStartFrames,
      naturalDurationFrames: clip.naturalDurationFrames,
      startFrame: startFrame + cursor,
      durationInFrames: dur,
    });
    cursor += dur;
  }
  return out;
}

// ─── Duration math ───────────────────────────────────────────────────────

function computeOverlayContentFrames(
  overlay: TemplateOverlayBlock,
  bpm: number,
  ctx: PreviewContext
): number {
  if (overlay.kind !== 'staggered-list') return 0;
  const beatsPerItem = overlay.stagger.beatsPerItem;
  const secPerBeat = 60 / bpm;
  const itemsCount = countStaggeredItems(overlay, ctx);
  const lead = overlay.lead ? 1 : 0;
  const trail = overlay.trail ? 1 : 0;
  const beats = (lead + itemsCount + trail) * beatsPerItem + beatsPerItem;
  return Math.round(beats * secPerBeat * FPS);
}

function countStaggeredItems(
  overlay: TemplateStaggeredList,
  ctx: PreviewContext
): number {
  const itemsResolver = buildSlotResolver<string[]>(ctx, 'script');
  const resolved = resolveSlot<string[]>(overlay.items.texts, itemsResolver);
  if (!resolved || !Array.isArray(resolved)) return 1;
  return Math.max(1, resolved.length);
}

function resolveBpmForDoc(doc: TemplateDoc, ctx: PreviewContext): number {
  const musicSlot = doc.globals.audio.music;
  if (musicSlot) {
    const resolver = buildSlotResolver<MusicSelection>(ctx, 'music');
    const resolved = resolveSlot<MusicSelection>(musicSlot, resolver);
    if (resolved) {
      const track = getMusicTrackById(resolved.trackId);
      if (track?.bpm) return track.bpm;
    }
  }
  const fallback =
    getMusicTrackById(ctx.musicTrackId) ?? SHARED_MUSIC_TRACKS[0];
  return fallback?.bpm ?? 100;
}

function findFirstLeaf(region: TemplateRegion): {
  spine: TemplateSpineBlock[];
  overlays: TemplateOverlayBlock[];
} {
  if (region.kind === 'leaf') {
    return { spine: region.spine, overlays: region.overlays };
  }
  for (const child of region.children) {
    const found = findFirstLeaf(child.region);
    if (found.spine.length > 0 || found.overlays.length > 0) return found;
  }
  return { spine: [], overlays: [] };
}

interface ResolvedDurations {
  totalFrames: number;
  spineDurations: number[];
  overlayDurations: number[];
}

function resolveMasterTotal(
  master: TemplateDuration,
  overlays: TemplateOverlayBlock[],
  bpm: number,
  ctx: PreviewContext
): number {
  if (master.kind === 'fixed') return Math.max(1, master.frames);
  const driver = overlays.find((o) => o.id === master.by);
  if (driver && driver.duration.kind === 'content') {
    return computeOverlayContentFrames(driver, bpm, ctx);
  }
  if (driver && driver.duration.kind === 'fixed') {
    return Math.max(1, driver.duration.frames);
  }
  return FPS * 5;
}

function distributeSpine(
  spine: TemplateSpineBlock[],
  totalFrames: number,
  bpm: number
): number[] {
  if (spine.length === 0) return [];
  const fixedSum = spine
    .filter((b) => b.duration.kind === 'fixed')
    .reduce(
      (acc, b) =>
        acc + (b.duration as { kind: 'fixed'; frames: number }).frames,
      0
    );

  const contentSpineFrames = spine.map((b: TemplateSpineBlock) =>
    b.duration.kind === 'content' ? Math.round((60 / bpm) * 4 * FPS) : 0
  );
  const contentSum = contentSpineFrames.reduce((a, b) => a + b, 0);

  const fillBlocks = spine
    .map((b, i) => ({ block: b, i }))
    .filter(({ block }) => block.duration.kind === 'fill');
  const totalFillWeight = fillBlocks.reduce(
    (acc, { block }) =>
      acc + ((block.duration as { kind: 'fill'; weight?: number }).weight ?? 1),
    0
  );

  const remaining = Math.max(0, totalFrames - fixedSum - contentSum);

  const out: number[] = spine.map((b, i) => {
    if (b.duration.kind === 'fixed') return b.duration.frames;
    if (b.duration.kind === 'content') return contentSpineFrames[i] ?? 0;
    const weight =
      (b.duration as { kind: 'fill'; weight?: number }).weight ?? 1;
    if (totalFillWeight === 0) return 0;
    return Math.floor((remaining * weight) / totalFillWeight);
  });

  const lastFill = [...out.keys()]
    .reverse()
    .find((i) => spine[i]?.duration.kind === 'fill');
  if (lastFill !== undefined) {
    const sum = out.reduce((a, b) => a + b, 0);
    out[lastFill] += totalFrames - sum;
    if ((out[lastFill] ?? 0) < 1) out[lastFill] = 1;
  }
  return out;
}

function distributeOverlays(
  overlays: TemplateOverlayBlock[],
  totalFrames: number,
  bpm: number,
  ctx: PreviewContext
): number[] {
  return overlays.map((o) => {
    if (o.duration.kind === 'fixed') return o.duration.frames;
    if (o.duration.kind === 'content') {
      return Math.min(totalFrames, computeOverlayContentFrames(o, bpm, ctx));
    }
    return totalFrames;
  });
}

function resolveDurations(
  doc: TemplateDoc,
  spine: TemplateSpineBlock[],
  overlays: TemplateOverlayBlock[],
  bpm: number,
  ctx: PreviewContext
): ResolvedDurations {
  const totalFrames = resolveMasterTotal(doc.duration, overlays, bpm, ctx);
  const spineDurations = distributeSpine(spine, totalFrames, bpm);
  const overlayDurations = distributeOverlays(overlays, totalFrames, bpm, ctx);
  return { totalFrames, spineDurations, overlayDurations };
}

// ─── Block resolvers ─────────────────────────────────────────────────────

function resolveMediaTrack(
  block: TemplateMediaTrack,
  startFrame: number,
  durationInFrames: number,
  ctx: PreviewContext
): ResolvedMediaTrackBlock | { error: string } {
  const resolver = buildSlotResolver<MediaSource[]>(ctx, 'clips');
  const clips = resolveSlot<MediaSource[]>(block.clips, resolver);
  if (!clips || clips.length === 0) {
    return { error: `media-track "${block.id}" has no clips resolved` };
  }
  return {
    kind: 'media-track',
    id: block.id,
    startFrame,
    durationInFrames,
    clips: distributeClips(clips, 0, durationInFrames),
    fit: block.fit,
  };
}

function resolveSolid(
  block: TemplateSolid,
  startFrame: number,
  durationInFrames: number,
  ctx: PreviewContext
): ResolvedBlock | { error: string } {
  const resolver = buildSlotResolver<string>(ctx, 'brand');
  const color = resolveSlot<string>(block.color, resolver);
  if (!color) {
    return { error: `solid "${block.id}" has no color resolved` };
  }
  return {
    kind: 'solid',
    id: block.id,
    startFrame,
    durationInFrames,
    color,
  };
}

function resolveStaggeredList(
  block: TemplateStaggeredList,
  startFrame: number,
  durationInFrames: number,
  bpm: number,
  ctx: PreviewContext
): ResolvedStaggeredListBlock | { error: string } {
  const scriptResolverString = buildSlotResolver<string>(ctx, 'script');
  const scriptResolverArr = buildSlotResolver<string[]>(ctx, 'script');

  const leadText = block.lead
    ? resolveSlot<string>(block.lead.text, (q) => {
        const v = scriptResolverString(q);
        if (Array.isArray(v)) return v[0];
        return v;
      })
    : undefined;
  const itemsRaw = resolveSlot<string[]>(block.items.texts, scriptResolverArr);
  const items = Array.isArray(itemsRaw)
    ? itemsRaw
    : itemsRaw
      ? [itemsRaw as unknown as string]
      : [];
  const trailText = block.trail
    ? resolveSlot<string>(block.trail.text, (q) => {
        const v = scriptResolverString(q);
        if (Array.isArray(v)) return v.at(-1);
        return v;
      })
    : undefined;

  if (block.lead?.text && !leadText) {
    return { error: `staggered-list "${block.id}" lead slot unresolved` };
  }
  if (items.length === 0) {
    return { error: `staggered-list "${block.id}" items slot unresolved` };
  }

  const framesPerBeat = Math.round((60 / bpm) * FPS);
  const beatsPerItem = block.stagger.beatsPerItem;
  const framesPerItem = framesPerBeat * beatsPerItem;

  const lead: ResolvedTextElement | undefined =
    block.lead && leadText !== undefined
      ? {
          id: `${block.id}-lead`,
          text: leadText,
          typeStyle: getTypeStyle(block.lead.style, engineDefaultTheme),
          container: block.lead.container,
          entrance: block.lead.entrance,
          entranceFrame: 0,
        }
      : undefined;

  const itemElements: ResolvedTextElement[] = items.map((text, i) => ({
    id: `${block.id}-item-${i}`,
    text,
    typeStyle: getTypeStyle(block.items.style, engineDefaultTheme),
    container: block.items.container,
    entrance: block.items.entrance,
    entranceFrame: framesPerItem * (i + 1),
  }));

  const trail: ResolvedTextElement | undefined =
    block.trail && trailText !== undefined
      ? {
          id: `${block.id}-trail`,
          text: trailText,
          typeStyle: getTypeStyle(block.trail.style, engineDefaultTheme),
          container: block.trail.container,
          entrance: block.trail.entrance,
          entranceFrame: framesPerItem * (items.length + 1),
        }
      : undefined;

  return {
    kind: 'staggered-list',
    id: block.id,
    startFrame,
    durationInFrames,
    lead,
    items: itemElements,
    trail,
    beatsPerItemFrames: framesPerItem,
    placement: block.placement as ResolvedOverlayPlacement | undefined,
  };
}

// ─── Public entrypoint ───────────────────────────────────────────────────

export function stubSynthesize(
  doc: TemplateDoc,
  ctx: PreviewContext
): StubSynthesizeResult {
  try {
    const orientation: RenderOrientation = doc.aspectRatios[0] ?? 'portrait';
    const bpm = resolveBpmForDoc(doc, ctx);
    const { spine, overlays } = findFirstLeaf(doc.root);

    if (spine.length === 0 && overlays.length === 0) {
      return { ok: false, error: 'Template root has no renderable blocks.' };
    }

    const durations = resolveDurations(doc, spine, overlays, bpm, ctx);

    const resolvedSpine: ResolvedBlock[] = [];
    let cursor = 0;
    for (let i = 0; i < spine.length; i++) {
      const block = spine[i];
      const dur = durations.spineDurations[i] ?? 0;
      if (!block || dur <= 0) continue;
      if (block.kind === 'media-track') {
        const resolved = resolveMediaTrack(block, cursor, dur, ctx);
        if ('error' in resolved) return { ok: false, error: resolved.error };
        resolvedSpine.push(resolved);
      } else if (block.kind === 'solid') {
        const resolved = resolveSolid(block, cursor, dur, ctx);
        if ('error' in resolved) return { ok: false, error: resolved.error };
        resolvedSpine.push(resolved);
      }
      cursor += dur;
    }

    const resolvedOverlays: ResolvedBlock[] = [];
    for (let i = 0; i < overlays.length; i++) {
      const block = overlays[i];
      const dur = durations.overlayDurations[i] ?? 0;
      if (!block || dur <= 0) continue;
      if (block.kind !== 'staggered-list') continue;
      const resolved = resolveStaggeredList(block, 0, dur, bpm, ctx);
      if ('error' in resolved) return { ok: false, error: resolved.error };
      resolvedOverlays.push(resolved);
    }

    let music: ResolvedMusicTrack | undefined;
    const musicSlot = doc.globals.audio.music;
    if (musicSlot) {
      const resolver = buildSlotResolver<MusicSelection>(ctx, 'music');
      const sel = resolveSlot<MusicSelection>(musicSlot, resolver);
      if (sel) {
        const track = getMusicTrackById(sel.trackId);
        if (track) {
          music = {
            trackId: track.id,
            url: track.path,
            volume: sel.volume,
            bpm: track.bpm,
          };
        }
      }
    }

    const totalFrames = Math.max(1, durations.totalFrames);
    const dimensions = DIMENSIONS_BY_ORIENTATION[orientation];

    const root: ResolvedRegion = {
      kind: 'leaf',
      id: 'main',
      spine: resolvedSpine,
      overlays: resolvedOverlays,
    };

    return {
      ok: true,
      renderDoc: {
        schemaVersion: 2,
        videoId: 'editor-stub',
        templateDocId: doc.id,
        fps: FPS,
        dimensions,
        durationInFrames: totalFrames,
        orientation,
        root,
        globals: {
          audio: { music },
          // Stub uses the engine defaults so previews exercise the wave-5
          // theme-binding path even when the editor doesn't author a real
          // brand_kit.
          theme: engineDefaultTheme,
        },
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Unknown synthesis error',
    };
  }
}

// Re-export for callers that want to know the duration types they're feeding.
export type { BlockDuration, TemplateDuration };
