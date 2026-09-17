import type { z } from 'zod';

// BlockDef contract (§12, §16).
//
// One BlockDef per block kind, owning *the data side* of a block:
//   - the Zod schema that validates its TemplateDoc shape (with slots),
//   - the Zod schema that validates its RenderDoc shape (resolved),
//   - the contract for computing how long a `duration: content` instance is.
//
// Note: BlockDef intentionally has NO React component. The renderer side is in
// @borradh-workspace/remotion/blocks (BlockRenderer). Wire each kind in both
// registries; if a `kind` exists in one and not the other, the system fails
// closed at synthesis-time validation.

export interface ComputeContentDurationCtx {
  fps: number;
  /** Active music BPM when present — used by beat-driven blocks. */
  musicBpm?: number;
  /**
   * When a block's content length depends on a count the resolver can't see
   * from `params` alone (e.g. staggered-list's items slot resolves to N
   * strings at synthesis time), callers pass it in here. The resolver also
   * accepts an explicit `contentDurationOverrides[id]` override that
   * short-circuits the compute entirely.
   */
  resolvedItemCount?: number;
}

export interface BlockDef<
  // biome-ignore lint/suspicious/noExplicitAny: BlockDef is intentionally
  // erased in storage maps; per-kind callsites narrow back to the concrete
  // generic before reading params.
  TDoc = any,
  // biome-ignore lint/suspicious/noExplicitAny: see above.
  TResolved = any,
> {
  kind: string;
  /**
   * 'spine'   — laid out sequentially in the leaf, occupies layout time.
   * 'overlay' — absolute-positioned on top of the spine, free-floating.
   */
  category: 'spine' | 'overlay';
  /** Zod schema for the TemplateDoc shape (with Slot<…> in fillable spots). */
  docSchema: z.ZodType<TDoc>;
  /** Zod schema for the resolved/RenderDoc shape (no slots, frames absolute). */
  resolvedSchema: z.ZodType<TResolved>;
  /**
   * Length, in absolute frames, that a `duration: content` instance of this
   * block naturally occupies. Called by the duration resolver. Wave-1 blocks
   * (`media-track`, `solid`) don't drive content length — only overlays do —
   * but the contract is on every BlockDef so wave-2 blocks can fill in without
   * a schema bump.
   *
   * Returning undefined means "this kind doesn't define a content length";
   * callers either substitute a default or surface a lint error.
   */
  computeContentDuration?(
    params: TDoc,
    ctx: ComputeContentDurationCtx
  ): number | undefined;

  // Reserved for wave-3+ lints (contrast, safe-area, readable duration, decode
  // budget — see §15.3, §15.5). Declared empty here so a BlockDef interface
  // change isn't needed when lint rules start landing.
  lints?: never;
}
