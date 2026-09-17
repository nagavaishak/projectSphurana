// General duration resolver (P3.15, §8).
//
// Replaces the hardcoded educational-1 math in the Phase B compiler with a
// generic pass that walks a TemplateDoc's region tree and produces absolute
// frames for every block.
//
// Resolution rules:
//   1. Master duration
//      - 'fixed' → frames as authored.
//      - 'driven' by 'narration' → caller supplies narrationDurationFrames.
//      - 'driven' by an ElementId → that element's resolved content length.
//   2. Per region
//      - sum 'fixed' + 'content' beats.
//      - distribute (master - sum) across 'fill' beats by weight.
//      - region with no 'fill' and sum != master → InvalidDurationError.
//   3. content lengths come from BlockDef.computeContentDuration(params, ctx).
//      undefined → caller must pass an override in `contentDurationOverrides`.

import type { BlockDef, ComputeContentDurationCtx } from './block-def.js';

export interface BeatInput {
  /** Stable block id (required when a master 'driven by' refers to it). */
  id?: string;
  /** Block kind, used to look up the BlockDef for content-length compute. */
  kind: string;
  /**
   * Mirrors `BlockDuration` from template-doc but typed loose here so the
   * resolver doesn't pull a circular import on TemplateDoc.
   */
  duration:
    | { kind: 'fixed'; frames: number }
    | { kind: 'content' }
    | { kind: 'fill'; weight?: number };
  /**
   * Raw block params — passed through to `computeContentDuration` when the
   * duration kind is 'content'.
   */
  params: unknown;
}

export interface ResolveTimelineCtx extends ComputeContentDurationCtx {
  /** Block registry — keyed by `kind`. */
  blockRegistry: Record<string, BlockDef>;
  /**
   * Override for a beat's computed content length, keyed by beat id.
   * Used when `computeContentDuration` returns undefined (e.g.
   * staggered-list needs an item count the resolver can't see).
   */
  contentDurationOverrides?: Record<string, number>;
  /** When master.kind === 'driven' by 'narration', supplied by caller. */
  narrationDurationFrames?: number;
  /** Used when master 'driven by' refers to a beat id, but caller wants to
   * cap (e.g. clamp to a known music track length). */
  masterFramesOverride?: number;
}

export type MasterDurationInput =
  | { kind: 'fixed'; frames: number }
  | { kind: 'driven'; by: 'narration' | string };

export class InvalidDurationError extends Error {
  readonly path: string;
  constructor(message: string, path = '') {
    super(message);
    this.name = 'InvalidDurationError';
    this.path = path;
  }
}

export class InvalidClipRefError extends Error {
  readonly clipRef: string;
  constructor(clipRef: string, message?: string) {
    super(message ?? `Invalid clipRef: ${clipRef}`);
    this.name = 'InvalidClipRefError';
    this.clipRef = clipRef;
  }
}

export interface ResolvedTimeline {
  masterFrames: number;
  /** One entry per input beat, in input order. */
  beatFrames: number[];
}

function getContentLength(
  beat: BeatInput,
  ctx: ResolveTimelineCtx,
  path: string
): number {
  if (beat.id) {
    const override = ctx.contentDurationOverrides?.[beat.id];
    if (override !== undefined) return override;
  }
  const def = ctx.blockRegistry[beat.kind];
  if (!def) {
    throw new InvalidDurationError(
      `No BlockDef registered for kind "${beat.kind}"`,
      path
    );
  }
  const computed = def.computeContentDuration?.(beat.params, ctx);
  if (computed === undefined) {
    throw new InvalidDurationError(
      `Cannot resolve content duration for "${beat.kind}"${
        beat.id ? ` (id=${beat.id})` : ''
      } — block did not compute a length and no override was supplied`,
      path
    );
  }
  return Math.max(1, Math.round(computed));
}

function resolveRegionBeats(
  beats: BeatInput[],
  masterFrames: number,
  ctx: ResolveTimelineCtx,
  path = 'root'
): number[] {
  if (beats.length === 0) return [];

  const fixedOrContent: number[] = beats.map((beat, i) => {
    const beatPath = `${path}.beat[${i}]`;
    if (beat.duration.kind === 'fixed') {
      return Math.max(1, Math.round(beat.duration.frames));
    }
    if (beat.duration.kind === 'content') {
      return getContentLength(beat, ctx, beatPath);
    }
    return 0;
  });

  const fillBeats: { index: number; weight: number }[] = [];
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    if (beat && beat.duration.kind === 'fill') {
      fillBeats.push({ index: i, weight: beat.duration.weight ?? 1 });
    }
  }

  const sumNonFill = fixedOrContent.reduce((a, b) => a + b, 0);

  if (fillBeats.length === 0) {
    if (sumNonFill !== masterFrames) {
      throw new InvalidDurationError(
        `Region "${path}" has no 'fill' beats but its fixed+content sum (${sumNonFill}) does not equal master (${masterFrames}). Add a 'fill' beat or adjust durations.`,
        path
      );
    }
    return fixedOrContent;
  }

  const remaining = masterFrames - sumNonFill;
  if (remaining < 0) {
    throw new InvalidDurationError(
      `Region "${path}" content/fixed sum (${sumNonFill}) exceeds master ` +
        `(${masterFrames}); 'fill' beats have nothing to absorb.`,
      path
    );
  }

  const totalWeight = fillBeats.reduce((a, b) => a + b.weight, 0) || 1;

  const result = [...fixedOrContent];
  let distributed = 0;
  for (let f = 0; f < fillBeats.length; f++) {
    const fill = fillBeats[f];
    if (!fill) continue;
    const isLast = f === fillBeats.length - 1;
    const share = isLast
      ? remaining - distributed
      : Math.round((remaining * fill.weight) / totalWeight);
    result[fill.index] = Math.max(1, share);
    distributed += result[fill.index] ?? 0;
  }

  return result;
}

export function resolveMasterFrames(
  master: MasterDurationInput,
  beats: BeatInput[],
  ctx: ResolveTimelineCtx
): number {
  if (ctx.masterFramesOverride !== undefined) {
    return Math.max(1, Math.round(ctx.masterFramesOverride));
  }

  if (master.kind === 'fixed') {
    return Math.max(1, Math.round(master.frames));
  }

  if (master.by === 'narration') {
    if (ctx.narrationDurationFrames === undefined) {
      throw new InvalidDurationError(
        `Master duration is 'driven by narration' but no narrationDurationFrames was supplied`
      );
    }
    return Math.max(1, Math.round(ctx.narrationDurationFrames));
  }

  // master.by is an ElementId — find the matching beat and resolve its
  // content length. A 'fill'/'fixed' beat can also be referenced; we use its
  // explicit length (fixed) or its content length (content). 'fill' as a
  // driver is meaningless because fill needs a master to size against, so we
  // reject it.
  const target = beats.find((b) => b.id === master.by);
  if (!target) {
    throw new InvalidDurationError(
      `Master duration references unknown ElementId "${master.by}"`
    );
  }
  if (target.duration.kind === 'fill') {
    throw new InvalidDurationError(
      `Master duration cannot be driven by a 'fill' beat ("${master.by}"); fill needs a master to size against.`
    );
  }
  if (target.duration.kind === 'fixed') {
    return Math.max(1, Math.round(target.duration.frames));
  }
  return getContentLength(target, ctx, `driver:${master.by}`);
}

export function resolveTimeline(
  master: MasterDurationInput,
  beats: BeatInput[],
  ctx: ResolveTimelineCtx
): ResolvedTimeline {
  const masterFrames = resolveMasterFrames(master, beats, ctx);
  const beatFrames = resolveRegionBeats(beats, masterFrames, ctx);
  return { masterFrames, beatFrames };
}
