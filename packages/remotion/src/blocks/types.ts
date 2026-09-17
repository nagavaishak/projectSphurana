import type {
  ResolvedBlock,
  ResolvedRegion,
} from '@borradh-workspace/video-templates';
import type React from 'react';

// Context passed to every block renderer. Anything block-agnostic that the
// renderer might need (fps, orientation, parent region for layout, etc.) goes
// here so block components stay stateless.
export interface BlockRendererCtx {
  fps: number;
  orientation: 'portrait' | 'landscape' | 'square';
  /**
   * The leaf region that contains this block. Useful for overlays that want to
   * know their parent's pixel rectangle (when wave-3 wires layout).
   */
  region: ResolvedRegion;
}

// Render props for a single block. The block's typed shape is upcast to the
// union here; concrete BlockRenderer<TResolved> entries do a runtime check
// inside their Component before reading specific fields.
export interface BlockRendererProps {
  block: ResolvedBlock;
  ctx: BlockRendererCtx;
}

export interface BlockRenderer<
  TResolved extends ResolvedBlock = ResolvedBlock,
> {
  kind: TResolved['kind'];
  Component: React.FC<BlockRendererProps>;
}
