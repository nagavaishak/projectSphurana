import { ImageIcon, Play } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';
import { VideoThumbnail } from '@/routes/_authed/create-video/$templateId/-components/shared/video-thumbnail';

export interface MediaThumbProps {
  type: 'image' | 'video';
  /** Primary media URL — an image src, or the raw video file for videos. */
  url?: string | null;
  /** Dedicated thumbnail (preferred when present, required for clean video posters). */
  thumbnailUrl?: string | null;
  alt?: string;
  /** Show a centered play badge over video previews. Default `true`. */
  showPlayBadge?: boolean;
  /** Tailwind size for the fallback icon + play badge. Default `size-6`. */
  iconClassName?: string;
  className?: string;
}

/**
 * Robust media thumbnail used across the socials surface.
 *
 * When a video post has no poster we paint a real first frame instead of an
 * empty box. Seeking a preloaded video does not reliably paint a frame (see
 * VideoThumbnail), so the posterless path defers to that shared component,
 * which autoplays muted and pauses on the first frame. Broken image/video
 * URLs degrade to a type icon rather than the browser's broken-image glyph.
 */
export function MediaThumb({
  type,
  url,
  thumbnailUrl,
  alt = '',
  showPlayBadge = true,
  iconClassName = 'size-6',
  className,
}: MediaThumbProps) {
  const [failed, setFailed] = useState(false);
  const isVideo = type === 'video';

  const imageSrc = thumbnailUrl ?? (isVideo ? null : (url ?? null));
  const videoSrc = isVideo && !thumbnailUrl && url ? url : null;

  const showIcon = failed || (!imageSrc && !videoSrc);

  return (
    <div
      className={cn('relative size-full overflow-hidden bg-muted', className)}
    >
      {showIcon ? (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          {isVideo ? (
            <Play className={iconClassName} />
          ) : (
            <ImageIcon className={iconClassName} />
          )}
        </div>
      ) : imageSrc ? (
        <img
          src={imageSrc}
          alt={alt}
          // Graphics have no small thumbnail variant — tiles load the full-res
          // slide PNG. Lazy + async-decode so only visible tiles fetch and a
          // large decode never blocks the grid from painting.
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : videoSrc ? (
        <VideoThumbnail
          src={videoSrc}
          className="size-full"
          onError={() => setFailed(true)}
        />
      ) : null}

      {isVideo && showPlayBadge && !showIcon && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/15">
          <Play className={cn('fill-white text-white', iconClassName)} />
        </div>
      )}
    </div>
  );
}
