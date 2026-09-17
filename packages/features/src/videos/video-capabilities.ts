/**
 * What a video draft can DO — declared, not inferred.
 *
 * WHY THIS EXISTS
 * ---------------
 * `packages/features/src/image-generation/regeneration-intent.ts` explains the
 * failure this guards against: a symptom is reported, the path that produced it
 * is narrowed until the symptom stops, and an adjacent capability silently
 * dies. Nothing throws. The route stays reachable, the tool keeps its
 * parameter, the endpoint-coverage gate stays green. Reachable is not capable.
 *
 * Videos had the same shape of hole, reached by a different road. Clip
 * selection lived as an inline conditional in the planner and clip EDITING had
 * no named operation at all — `patchDraftVideo` takes `Partial<DraftConfig>`,
 * and `deepMergeDraftConfig` replaces arrays wholesale. So the only way to
 * change one clip was to resend every clip, and a short array silently dropped
 * the rest. The skill text made that concrete rather than theoretical: it
 * instructed Claire to send `bRollClips: ids.map((id, i) => ({ assetId: id,
 * order: i }))` — a full-array rebuild from whatever subset she had in view.
 *
 * So the capabilities are named here, each with the inputs it depends on in ONE
 * table rather than in conditionals spread through the planner and the merge.
 * Every entry is asserted by a capability test, which means removing an input a
 * capability needs is a build failure rather than a customer report weeks later.
 *
 * SCOPE — deliberately not everything
 * -----------------------------------
 * Pinning every behaviour ossifies the product; the cost of a registry entry is
 * that changing the behaviour now requires changing a declaration and a test.
 * Entries below earn that cost by being expensive to lose QUIETLY: either a
 * customer has already reported losing them, or losing them produces content
 * that renders successfully and is wrong — the failure mode with no alarm.
 */

import type { BRollClipConfig } from '@borradh-workspace/database';

/** Every named video capability. */
export type VideoCapability =
  /** Replace the clip at one position; every other position survives. */
  | 'video.swap-clip'
  /** Drop the clip at one position; every other position survives. */
  | 'video.remove-clip'
  /** Replace the whole clip list. Destructive BY DESIGN, and now by name. */
  | 'video.replace-all-clips'
  /** Choose the footage a video opens with. */
  | 'video.select-footage'
  /** Speak the script — recorded, synthesised, or not at all. */
  | 'video.narration'
  /** Burn subtitles over the render. */
  | 'video.captions'
  /** Lay a music bed under the render. */
  | 'video.music';

/**
 * How a clip operation names the clip it acts on.
 *
 * Both addressings are supported because neither alone is sufficient.
 *
 * `index` is what a human means — "the second clip" — and is the only way to
 * name one occurrence when the same asset appears twice. That is not a corner
 * case: the planner fills to `recommendedClipCount` by CYCLING a service's own
 * clips, so a service with two clips and a four-clip template produces genuine
 * duplicates.
 *
 * `assetId` is what a model can name without a read. Claire has no read of
 * `draftConfig.bRollClips` at all — `videos_listDraftClips` returns the
 * `video_draft_clip` tray, which is a DIFFERENT representation from the array
 * the renderer consumes. Index-only addressing would therefore declare a
 * capability she has no way to aim.
 *
 * Both fields are optional at the TYPE level rather than an exclusive union,
 * because this shape crosses a zod boundary: the request schema enforces
 * exactly-one with a refinement, and a refinement cannot narrow an inferred
 * type. Making the type an XOR would force every caller to cast — which would
 * defeat the check rather than strengthen it. `resolvePosition` therefore
 * treats "named neither" as a real failure instead of assuming it away.
 */
export interface ClipAddress {
  readonly index?: number;
  readonly targetAssetId?: string;
}

/** A named, server-applied edit to the clip list. */
export type ClipOperation =
  | ({ readonly op: 'swap'; readonly assetId: string } & ClipAddress)
  | ({ readonly op: 'remove' } & ClipAddress)
  | { readonly op: 'replace-all'; readonly clips: readonly BRollClipConfig[] };

/** What an edit operation is guaranteed to do, and to leave alone. */
export interface ClipOperationContract {
  /**
   * Whether clips the caller did not name survive the operation.
   *
   * This is THE property the whole module exists for. `swap` and `remove` must
   * be true; `replace-all` is false, which is legitimate — it is the operation
   * whose entire purpose is to replace the list. The point is that a caller now
   * has to ASK for that by name instead of arriving at it by sending a short
   * array to a generic patch.
   */
  readonly preservesUntouchedClips: boolean;
  /** Addressings the operation accepts. */
  readonly addressableBy: readonly ('index' | 'assetId')[];
  /** Whether a replacement asset is required to express the operation. */
  readonly requiresReplacementAsset: boolean;
  /**
   * Whether `order` is recompacted to 0..n-1 afterwards.
   *
   * `remove` must, or the render sees a gap in the sequence. `swap` must not —
   * renumbering a swap would reorder a list the caller only meant to edit
   * in place.
   */
  readonly renumbersOrder: boolean;
}

export const CLIP_OPERATION_CONTRACTS: Record<
  ClipOperation['op'],
  ClipOperationContract
> = {
  swap: {
    preservesUntouchedClips: true,
    addressableBy: ['index', 'assetId'],
    requiresReplacementAsset: true,
    renumbersOrder: false,
  },
  remove: {
    preservesUntouchedClips: true,
    addressableBy: ['index', 'assetId'],
    requiresReplacementAsset: false,
    renumbersOrder: true,
  },
  'replace-all': {
    preservesUntouchedClips: false,
    addressableBy: [],
    requiresReplacementAsset: false,
    renumbersOrder: true,
  },
};

/**
 * Which sources footage selection may draw on, and what gates them.
 *
 * Each flag exists because sending it, or withholding it, changes whether a
 * capability works — they are not stylistic preferences.
 */
export interface FootageSelectionInputs {
  /**
   * The organization's own uploads for this service.
   *
   * Always eligible. Authenticity is the reason an owner uploaded them.
   */
  readonly ownFootage: boolean;
  /**
   * Curated stock matched to this service.
   *
   * A PARTICIPANT in rotation, not a tier below it. As a fallback it only ever
   * appeared when a service had nothing — which meant a service with one clip
   * opened on that clip forever, the single most-reported repetition complaint.
   */
  readonly stockFootage: boolean;
  /**
   * The shared quality floor (`claimRotatedAsset`'s `MIN_QUALITY_SCORE` and
   * defect flags).
   *
   * Videos had no floor at all, so a shaky or blurry clip was used exactly as
   * readily as a good one. Reusing the graphics floor rather than writing a
   * video-specific one is deliberate: two floors drift, and drift is the
   * failure this module exists to stop.
   */
  readonly qualityFloor: boolean;
  /**
   * `asset_service.last_used_at` / `use_count`, claimed and stamped atomically.
   *
   * Without it selection is order-stable, which is indistinguishable from
   * working on the first generation and wrong on every one after.
   */
  readonly rotationMemory: boolean;
}

/**
 * Footage selection, as one table.
 *
 * Own footage wins only on a TIE. That is the whole rule, and both cases the
 * owner described fall out of it without special-casing:
 *
 *   - One GOOD own clip. It is never-used, so it sorts first and is chosen and
 *     stamped. On the next ask it carries a timestamp and the stock clip does
 *     not, and `NULLS FIRST` sends selection to stock.
 *   - One BAD own clip. The quality floor excludes it, so stock wins from the
 *     start.
 *
 * It generalises too: three own clips and stock gives own, own, own, stock —
 * variety without discarding authenticity.
 */
export const FOOTAGE_SELECTION: FootageSelectionInputs = {
  ownFootage: true,
  stockFootage: true,
  qualityFloor: true,
  rotationMemory: true,
};

/**
 * Draft-config fields a capability owns.
 *
 * These are pinned for a narrower reason than the clip operations: each is a
 * field an unrelated patch must not disturb. `deepMergeDraftConfig` shallow-
 * merges nested objects one level deep, so `{ captions: { enabled: false } }`
 * preserves sibling caption fields — but only while `captions` stays a flat
 * object. Nesting a field one level deeper would silently start replacing
 * instead of merging, and the symptom would be a caption style quietly
 * reverting to default on an unrelated edit.
 */
export interface DraftFieldContract {
  /** The `VideoDraftConfig` key this capability owns. */
  readonly field: string;
  /**
   * Whether a partial patch of this field merges with what is already stored.
   *
   * True requires the stored value to be a FLAT object — the merge is one level
   * deep. False means the field is a scalar or an array and is replaced whole.
   */
  readonly partiallyPatchable: boolean;
}

export const DRAFT_FIELD_CONTRACTS: Record<
  'video.narration' | 'video.captions' | 'video.music',
  DraftFieldContract
> = {
  'video.narration': { field: 'narrationType', partiallyPatchable: false },
  'video.captions': { field: 'captions', partiallyPatchable: true },
  'video.music': { field: 'musicTrackId', partiallyPatchable: false },
};

/** Every capability, with why losing it quietly would be expensive. */
export const VIDEO_CAPABILITIES: Record<VideoCapability, string> = {
  'video.swap-clip':
    'Change one clip without resending the others. Lost, the only way to swap a clip is a full-array rebuild, which drops every clip the caller could not see.',
  'video.remove-clip':
    'Drop one clip without resending the others. Same failure as swap, and the resulting gap in `order` breaks the render sequence rather than the request.',
  'video.replace-all-clips':
    'Replace the whole list on purpose. Legitimate, but it must be ASKED for by name — arriving at it by accident is the bug.',
  'video.select-footage':
    "Open on footage that is the owner's, fresh, and not visibly bad. Lost, a service with one clip opens on it forever and a shaky clip gets equal airtime with a good one.",
  'video.narration':
    'Speak the script, or deliberately not. Lost, a video renders silent with no error.',
  'video.captions':
    'Burn subtitles. Lost, a patch to one caption field silently resets the others to default.',
  'video.music':
    'Lay a music bed. Lost, the render succeeds with no audio and nothing reports it.',
};

// ---------------------------------------------------------------------------
// Applying operations. Pure — the service supplies the stored list and
// persists the result, so these stay directly testable.
// ---------------------------------------------------------------------------

/** Why an operation could not be applied. Callers map these to error codes. */
export type ClipOperationFailure =
  | { readonly reason: 'index_out_of_range'; readonly index: number }
  | { readonly reason: 'asset_not_in_clips'; readonly assetId: string }
  | { readonly reason: 'address_not_named' }
  | { readonly reason: 'would_empty_clips' };

export type ClipOperationResult =
  | { readonly ok: true; readonly clips: BRollClipConfig[] }
  | { readonly ok: false; readonly failure: ClipOperationFailure };

/** Recompact `order` to 0..n-1 so the render never sees a gap. */
function renumber(clips: BRollClipConfig[]): BRollClipConfig[] {
  return clips.map((clip, i) => ({ ...clip, order: i }));
}

/**
 * Resolve an address to a position in the stored list.
 *
 * `targetAssetId` resolves to the FIRST occurrence. When an asset appears more
 * than once — which the planner's cycling makes routine — naming it by id is
 * inherently ambiguous, and picking the first is the only stable reading. A
 * caller that means a specific occurrence has `index` for exactly that.
 */
function resolvePosition(
  clips: readonly BRollClipConfig[],
  address: ClipAddress
): number | ClipOperationFailure {
  if (address.index !== undefined) {
    if (!Number.isInteger(address.index)) {
      return { reason: 'index_out_of_range', index: address.index };
    }
    if (address.index < 0 || address.index >= clips.length) {
      return { reason: 'index_out_of_range', index: address.index };
    }
    return address.index;
  }

  if (address.targetAssetId === undefined) {
    return { reason: 'address_not_named' };
  }

  const found = clips.findIndex((c) => c.assetId === address.targetAssetId);
  if (found === -1) {
    return { reason: 'asset_not_in_clips', assetId: address.targetAssetId };
  }
  return found;
}

/**
 * Apply one named operation to the stored clip list.
 *
 * The stored list is the input, so the caller never has to hold it — which is
 * the point. `swap` and `remove` touch exactly one position and copy the rest
 * through unchanged.
 */
export function applyClipOperation(
  clips: readonly BRollClipConfig[],
  operation: ClipOperation
): ClipOperationResult {
  if (operation.op === 'replace-all') {
    return { ok: true, clips: renumber([...operation.clips]) };
  }

  const position = resolvePosition(clips, operation);
  if (typeof position !== 'number') {
    return { ok: false, failure: position };
  }

  if (operation.op === 'swap') {
    const next = clips.map((clip, i) =>
      i === position
        ? { ...clip, assetId: operation.assetId, url: undefined }
        : clip
    );
    // No renumber: a swap edits in place, and recompacting would reorder a
    // list the caller only meant to change one element of.
    return { ok: true, clips: next };
  }

  // A render needs at least one clip. Removing the last one produces a draft
  // that cannot export, and the export failure would surface far from the edit
  // that caused it — so refuse here, where the cause is still legible.
  if (clips.length <= 1) {
    return { ok: false, failure: { reason: 'would_empty_clips' } };
  }

  return {
    ok: true,
    clips: renumber(clips.filter((_, i) => i !== position)),
  };
}

/** Apply operations left to right, stopping at the first failure. */
export function applyClipOperations(
  clips: readonly BRollClipConfig[],
  operations: readonly ClipOperation[]
): ClipOperationResult {
  let current: BRollClipConfig[] = [...clips];

  for (const operation of operations) {
    const result = applyClipOperation(current, operation);
    if (!result.ok) return result;
    current = result.clips;
  }

  return { ok: true, clips: current };
}
