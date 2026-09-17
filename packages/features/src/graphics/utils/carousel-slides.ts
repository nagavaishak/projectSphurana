import type { GraphicOutput } from '@borradh-workspace/database';

/**
 * Reduce a graphic's rendered `outputs` to the ordered list of slide URLs to
 * publish.
 *
 * - A single graphic has one output → one URL.
 * - A carousel has one output per slide, each tagged with `slideId` /
 *   `slideOrder`. We key by `slideId` (falling back to `slideOrder`) so a slide
 *   rendered at several aspect ratios collapses to ONE URL, and order by
 *   `slideOrder`.
 * - Failed or URL-less outputs are dropped.
 *
 * Crucially, when NO output carries slide metadata we treat the graphic as a
 * single image (return just the first URL) — a single graphic exported at
 * multiple aspect ratios must never be mistaken for a multi-image carousel.
 *
 * This is the single source of truth for "which images make up this graphic"
 * shared by the content-batch accept flow (which records the list on the
 * social post) and the publisher (which falls back to it for posts created
 * before the list existed).
 */
export function collectGraphicSlideUrls(
  outputs: readonly Pick<
    GraphicOutput,
    'url' | 'status' | 'slideId' | 'slideOrder'
  >[]
): string[] {
  const valid = outputs.filter(
    (o): o is typeof o & { url: string } => !!o.url && o.status !== 'failed'
  );
  if (valid.length === 0) return [];

  // Without per-slide metadata this is a single graphic (possibly multiple
  // aspect-ratio exports of the same image) — one image, not a carousel.
  const hasSlideMetadata = valid.some(
    (o) => o.slideId != null || o.slideOrder != null
  );
  if (!hasSlideMetadata) return [valid[0].url];

  const bySlide = new Map<string, { url: string; order: number }>();
  valid.forEach((o, index) => {
    const key = o.slideId ?? String(o.slideOrder ?? index);
    if (bySlide.has(key)) return; // first successful output per slide wins
    bySlide.set(key, { url: o.url, order: o.slideOrder ?? index });
  });
  return [...bySlide.values()]
    .sort((a, b) => a.order - b.order)
    .map((s) => s.url);
}
