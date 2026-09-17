import { cn } from '@/lib/utils';
import { useState } from 'react';

export interface CreativePreviewProps {
  /** Playable video URL. When set, a video player is shown (with `imageUrl` as poster). */
  videoUrl?: string | null;
  /** Image URL — the poster for a video, or the creative itself for an image ad. */
  imageUrl?: string | null;
  /** Alt text for the image. */
  alt?: string;
  /**
   * Intrinsic pixel dimensions, when the server already knows them (a rendered
   * graphic stores its own width/height). Supplying them means the frame is
   * correct on first paint instead of snapping into shape once the media loads.
   */
  width?: number | null;
  height?: number | null;
  /** Max height of the preview in pixels (default 520). */
  maxHeightPx?: number;
  /** Extra classes for the outer wrapper. */
  className?: string;
}

/** Frame shape used before the creative's real one is known — 4:5, the most common. */
const FALLBACK_ASPECT = 4 / 5;
/**
 * At or below this longest edge a source is a thumbnail, not a creative, and
 * blowing it up to panel width just makes a large blurry square. Meta's
 * `thumbnail_url` (64x64) is the case this exists for.
 */
const LOW_RES_MAX_EDGE = 320;
/** How far a low-resolution source may be scaled before it turns to mush. */
const LOW_RES_SCALE = 2;
/** Ceiling for a scaled-up low-resolution frame. */
const LOW_RES_MAX_WIDTH = 240;

/**
 * Preview for an ad / content creative — a video player or an image, falling
 * back to a placeholder.
 *
 * The frame takes the creative's REAL aspect ratio and is then made as large as
 * it can be inside both bounds — the container's width and `maxHeightPx`. That
 * is what `width: maxHeightPx * aspect` with `max-width: 100%` buys: the height
 * cap decides the width for tall creatives, the container decides it for wide
 * ones, and the aspect ratio derives the other side either way. A 9:16 gets a
 * tall narrow frame, a 4:5 and a 1:1 fill the width — and NOTHING letterboxes
 * or crops.
 *
 * Things this got wrong before, each of which was visible in production:
 *  - `shrink-0` is load-bearing. This renders inside a SCROLLING FLEX COLUMN
 *    (the ad side panel), where a flex item's aspect-ratio height is treated as
 *    shrinkable. Without it a 4:5 graphic was squashed into a 1.17 landscape
 *    box — measured 386x397 where it should have been 386x477 — and a 9:16
 *    video lost 42% of its frame to grey bars.
 *  - A 64x64 source must not be stretched across the panel. It gets a small
 *    frame and says so, rather than a full-width blur.
 *  - A failed source (an expired Meta thumbnail) degrades to a placeholder
 *    instead of a browser "broken image" icon.
 */
export function CreativePreview({
  videoUrl,
  imageUrl,
  alt = 'Creative preview',
  width,
  height,
  maxHeightPx = 520,
  className,
}: CreativePreviewProps) {
  // The creative's real dimensions, read from the media once it loads, for when
  // the server did not supply them.
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(
    null
  );
  // A failed source (e.g. an expired Meta thumbnail) → clean placeholder.
  const [mediaError, setMediaError] = useState(false);

  const showVideo = Boolean(videoUrl) && !mediaError;
  const showImage = !showVideo && Boolean(imageUrl) && !mediaError;

  if (!showVideo && !showImage) {
    return (
      <div
        className={cn(
          'flex aspect-video w-full shrink-0 items-center justify-center rounded-lg border bg-muted text-2xl',
          className
        )}
      >
        🎬
      </div>
    );
  }

  const w = width ?? measured?.w ?? null;
  const h = height ?? measured?.h ?? null;
  const aspect = w && h ? w / h : FALLBACK_ASPECT;
  // Only still images can be low-resolution here; a video always plays at its
  // own resolution regardless of what its poster is.
  const lowRes =
    showImage && w !== null && h !== null && Math.max(w, h) <= LOW_RES_MAX_EDGE;

  const frameStyle: React.CSSProperties = lowRes
    ? {
        width: Math.min((w as number) * LOW_RES_SCALE, LOW_RES_MAX_WIDTH),
        aspectRatio: aspect,
      }
    : {
        aspectRatio: aspect,
        width: maxHeightPx * aspect,
        maxWidth: '100%',
        maxHeight: maxHeightPx,
      };

  return (
    <div className={cn('shrink-0', className)}>
      <div
        className="relative mx-auto overflow-hidden rounded-lg border bg-muted"
        style={frameStyle}
      >
        {showVideo ? (
          <video
            src={videoUrl ?? undefined}
            className="absolute inset-0 h-full w-full object-contain"
            controls
            playsInline
            preload="metadata"
            poster={imageUrl ?? undefined}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight) {
                setMeasured({ w: v.videoWidth, h: v.videoHeight });
              }
            }}
            onError={() => setMediaError(true)}
          />
        ) : (
          <img
            src={imageUrl ?? undefined}
            alt={alt}
            className="absolute inset-0 h-full w-full object-contain"
            onLoad={(e) => {
              const i = e.currentTarget;
              if (i.naturalWidth && i.naturalHeight) {
                setMeasured({ w: i.naturalWidth, h: i.naturalHeight });
              }
            }}
            onError={() => setMediaError(true)}
          />
        )}
      </div>
      {lowRes ? (
        <p className="mt-1.5 text-center text-xs text-muted-foreground">
          Low-resolution preview ({w}×{h}) — the live ad uses the full-size
          creative.
        </p>
      ) : null}
    </div>
  );
}
