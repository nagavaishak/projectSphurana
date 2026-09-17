import type { Graphic } from '@/features/graphics/api/types';

/** Same logic as desktop `SelectVideoStep`. */
export function getGraphicThumbnail(graphic: Graphic): string | null {
  if (graphic.outputs?.length) {
    const firstOutput = graphic.outputs[0];
    if (typeof firstOutput === 'string') return firstOutput;
    return firstOutput.url;
  }
  return null;
}
