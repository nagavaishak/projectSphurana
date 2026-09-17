import { useCallback, useEffect, useRef, useState } from 'react';

interface VideoThumbnailProps {
  src: string;
  className?: string;
  /** When true, renders an <img> instead of <video> */
  isImage?: boolean;
  /** Fires when the media URL can't be loaded, so callers can degrade. */
  onError?: () => void;
  /**
   * Optional scroll-container to use as the IntersectionObserver root. Grids
   * that live inside their own `overflow-y-auto` box (e.g. the footage picker)
   * pass their scroll element here so off-screen tiles inside that box don't
   * eagerly fetch. Defaults to the viewport when omitted.
   */
  rootRef?: React.RefObject<HTMLElement | null>;
  /**
   * Play the clip while the pointer is over it, then return to the first frame.
   *
   * Lives here rather than in the callers because the callers that wanted it
   * hand-rolled the whole tile to get it — and hand-rolled the Safari bug with
   * it, since `preload="metadata"` plus a `#t=` seek is the approach this
   * component exists to replace. A tile that previews on hover should not have
   * to choose between that and painting at all.
   */
  playOnHover?: boolean;
}

/**
 * Video thumbnail that reliably shows the first frame on all browsers.
 *
 * Safari won't paint a video frame from preload/seek alone. The only
 * universally reliable approach is autoPlay + muted (guaranteed to work
 * without user interaction) then immediately pause on the first play event.
 *
 * Because that costs a real media fetch per tile, the <video> is only mounted
 * once the tile nears the viewport — the grids using this (galleries, the
 * planner list) would otherwise start every clip at once on mount, and
 * browsers cap concurrent media elements, so the tiles past the cap would
 * never paint at all. This mirrors loading="lazy" on the <img> path: it loads
 * once and stays, since a paused video costs nothing to keep.
 */
export function VideoThumbnail({
  src,
  className,
  isImage,
  onError,
  rootRef,
  playOnHover,
}: VideoThumbnailProps) {
  const pausedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (isImage) return;
    const el = containerRef.current;
    if (!el) return;
    // Without IntersectionObserver, load eagerly: painting the frame is this
    // component's reason to exist, so never trade it away for the fetch saving.
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      // Root defaults to the viewport; callers inside their own scroll box pass
      // it so laziness is scoped to that box rather than the whole page.
      { root: rootRef?.current ?? null, rootMargin: '300px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isImage, rootRef]);

  const handlePlay = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      // Only the FIRST play is the thumbnail paint. A hover play must be left
      // alone, or the clip would pause on the frame it started from and hover
      // would do nothing visible.
      if (pausedRef.current) return;
      pausedRef.current = true;
      const video = e.currentTarget;
      video.pause();
      video.currentTime = 0.001;
    },
    []
  );

  const hoverHandlers = playOnHover
    ? {
        onMouseEnter: (e: React.MouseEvent<HTMLVideoElement>) => {
          void e.currentTarget.play().catch(() => {});
        },
        onMouseLeave: (e: React.MouseEvent<HTMLVideoElement>) => {
          e.currentTarget.pause();
          e.currentTarget.currentTime = 0.001;
        },
      }
    : {};

  if (isImage) {
    return (
      <div className={className}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          className="w-full h-full object-cover"
          onError={onError}
        />
      </div>
    );
  }

  return (
    <div ref={containerRef} className={className}>
      {inView && (
        /* eslint-disable-next-line jsx-a11y/media-has-caption */
        <video
          src={src}
          className="w-full h-full object-cover"
          muted
          playsInline
          autoPlay
          preload="auto"
          onPlay={handlePlay}
          onError={onError}
          {...hoverHandlers}
        />
      )}
    </div>
  );
}
