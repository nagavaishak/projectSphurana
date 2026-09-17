import { infoCardRenderer } from './info-card';
import { mediaOverlayRenderer } from './media-overlay';
import { mediaTrackRenderer } from './media-track';
import { solidRenderer } from './solid';
import { staggeredListRenderer } from './staggered-list';
import { textRenderer } from './text';
import type { BlockRenderer } from './types';

// Renderer-side block registry. Mirrors the data-side blockRegistry in
// @borradh-workspace/video-templates: every kind known to the synthesizer
// MUST have a renderer here. The interpreter in template-renderer.tsx looks
// up by `block.kind`; missing kinds render nothing (with a console warning).
export const blockRenderers: Record<string, BlockRenderer> = {
  'media-track': mediaTrackRenderer,
  'staggered-list': staggeredListRenderer,
  text: textRenderer,
  'media-overlay': mediaOverlayRenderer,
  'info-card': infoCardRenderer,
  solid: solidRenderer,
};

export function getBlockRenderer(kind: string): BlockRenderer | undefined {
  return blockRenderers[kind];
}
