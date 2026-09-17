import { ChevronLeftIcon, ChevronRightIcon, ImageIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { Graphic, GraphicOutput } from '@/features/graphics';
import { cn } from '@/lib/utils';

export interface GraphicSlideCarouselProps {
  graphic: Graphic | null;
  /** Aspect ratio applied to the carousel viewport. Default `4/5`. */
  aspectRatio?: string;
  /** Max viewport height (any valid CSS dimension). Default `60vh`. */
  maxHeight?: string;
  /** Notified with the active slide index (0-based) whenever it changes. */
  onIndexChange?: (index: number) => void;
}

/**
 * Scrollable preview of every ready slide on a `Graphic`.
 *
 * Outer viewport clips overflow so only the active slide is visible. Inner
 * track lays every slide side-by-side and slides via `translateX(-i*100%)`.
 * Every `<img>` mounts when the carousel renders so each URL is fetched
 * exactly once on first show — subsequent prev/next swaps are instant.
 *
 * Hides itself when the graphic has no ready outputs (e.g. still rendering,
 * or all slides failed) — surface that case with a sibling status block.
 */
export function GraphicSlideCarousel({
  graphic,
  aspectRatio = '4 / 5',
  maxHeight = '60vh',
  onIndexChange,
}: GraphicSlideCarouselProps) {
  const urls = useMemo(() => readyGraphicUrls(graphic), [graphic]);
  const [index, setIndex] = useState(0);

  // Reset to the first slide whenever we switch to a different graphic.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only reset on graphic identity change
  useEffect(() => {
    setIndex(0);
  }, [graphic?.id]);

  // Surface the active slide to the parent (e.g. so a "regenerate this slide"
  // action knows which one is on screen).
  useEffect(() => {
    onIndexChange?.(index);
  }, [index, onIndexChange]);

  const hasSlides = urls.length > 0;
  const isCarousel = urls.length > 1;

  const goPrev = () =>
    setIndex((i) => (i - 1 + urls.length) % Math.max(urls.length, 1));
  const goNext = () => setIndex((i) => (i + 1) % Math.max(urls.length, 1));

  // Left/right arrow keys flip slides while the carousel is mounted.
  useEffect(() => {
    if (!isCarousel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        setIndex((i) => (i - 1 + urls.length) % urls.length);
      } else if (e.key === 'ArrowRight') {
        setIndex((i) => (i + 1) % urls.length);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isCarousel, urls.length]);

  if (!hasSlides) {
    return (
      <div
        className="flex w-full max-w-sm items-center justify-center rounded-md bg-muted text-muted-foreground"
        style={{ aspectRatio }}
      >
        <ImageIcon className="size-10" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        className="relative w-full overflow-hidden rounded-md bg-muted"
        style={{ aspectRatio, maxHeight }}
      >
        <div
          className="flex h-full transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {urls.map((u, i) => (
            <div
              key={u}
              className="flex h-full w-full shrink-0 items-center justify-center"
            >
              <img
                src={u}
                alt={`${graphic?.title ?? 'Graphic'} — slide ${i + 1}`}
                className="max-h-full max-w-full object-contain"
                draggable={false}
              />
            </div>
          ))}
        </div>

        {isCarousel && (
          <>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label="Previous slide"
              onClick={goPrev}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-background/80 shadow-md backdrop-blur-sm transition-transform hover:bg-background hover:scale-105"
            >
              <ChevronLeftIcon className="size-5" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label="Next slide"
              onClick={goNext}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-background/80 shadow-md backdrop-blur-sm transition-transform hover:bg-background hover:scale-105"
            >
              <ChevronRightIcon className="size-5" />
            </Button>
          </>
        )}
      </div>

      {isCarousel && (
        <>
          <div className="flex items-center justify-center gap-1.5 pt-1">
            {urls.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === index ? 'true' : undefined}
                onClick={() => setIndex(i)}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  i === index
                    ? 'w-5 bg-foreground'
                    : 'w-1.5 bg-muted-foreground/40 hover:bg-muted-foreground/70'
                )}
              />
            ))}
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Slide {index + 1} of {urls.length}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Pull every ready output from a graphic, sorted by `slideOrder` (then
 * `slideId` as a tiebreaker so order is stable when `slideOrder` is missing
 * on legacy rows). Skips failed slides.
 */
export function readyGraphicOutputs(g: Graphic | null): GraphicOutput[] {
  const outputs = g?.outputs as GraphicOutput[] | null | undefined;
  if (!outputs || outputs.length === 0) return [];
  return [...outputs]
    .filter((o) => (o.status ?? 'success') === 'success' && !!o.url)
    .sort((a, b) => {
      const ao = a.slideOrder ?? 0;
      const bo = b.slideOrder ?? 0;
      if (ao !== bo) return ao - bo;
      return (a.slideId ?? '').localeCompare(b.slideId ?? '');
    });
}

/** Full-res slide URLs in carousel order (used by the carousel/preview). */
export function readyGraphicUrls(g: Graphic | null): string[] {
  return readyGraphicOutputs(g).map((o) => o.url);
}

/**
 * Best thumbnail URL for a grid/list tile: the first ready slide's low-res
 * thumbnail when present, else its full-res URL. Null when nothing is ready.
 */
export function graphicThumbUrl(g: Graphic | null): string | null {
  const first = readyGraphicOutputs(g)[0];
  if (!first) return null;
  return first.thumbnailUrl ?? first.url;
}
