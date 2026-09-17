import { cn } from '@/lib/utils';
import { Check, ImageIcon, Loader2 } from 'lucide-react';

/** Format milliseconds as M:SS (e.g. 0:30). */
function formatDurationMs(
  durationMs: string | number | null | undefined
): string | null {
  if (durationMs === null || durationMs === undefined || durationMs === '') {
    return null;
  }
  const ms = typeof durationMs === 'string' ? Number(durationMs) : durationMs;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Format an asset duration stored in seconds as M:SS. */
function formatDurationSeconds(
  duration: string | number | null | undefined
): string | null {
  if (duration === null || duration === undefined || duration === '') {
    return null;
  }
  const seconds = typeof duration === 'string' ? Number(duration) : duration;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export interface ContentMediaItem {
  id: string;
  /**
   * What the tile IS, for assistive tech. The thumbnail is decorative
   * (`alt=""`), so without this every tile in the grid is an unlabelled button
   * and a screen-reader user cannot tell one clip from another.
   */
  name: string;
  thumbnailUrl: string | null;
  blobUrl: string | null;
  mediaType: 'image' | 'video';
  durationMs?: string | number | null;
  durationSeconds?: string | number | null;
}

interface ContentMobileMediaThumbProps {
  item: ContentMediaItem;
  selected: boolean;
  onSelect: () => void;
}

export function ContentMobileMediaThumb({
  item,
  selected,
  onSelect,
}: ContentMobileMediaThumbProps) {
  const durationLabel =
    formatDurationMs(item.durationMs) ??
    formatDurationSeconds(item.durationSeconds);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={item.name}
      data-testid="content-media-thumb"
      className={cn(
        'relative aspect-[3/4] w-full overflow-hidden rounded-xl bg-[#F2F2F7] text-left',
        selected && 'ring-2 ring-[#007AFF] ring-offset-2'
      )}
    >
      {item.thumbnailUrl ? (
        <img
          src={item.thumbnailUrl}
          alt=""
          className="size-full object-cover"
        />
      ) : item.blobUrl && item.mediaType === 'video' ? (
        <video
          src={item.blobUrl}
          className="size-full object-cover"
          muted
          playsInline
          preload="metadata"
          onLoadedData={(e) => {
            e.currentTarget.currentTime = 0.001;
          }}
        />
      ) : item.blobUrl ? (
        <img src={item.blobUrl} alt="" className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center text-[#C7C7CC]">
          <ImageIcon className="size-6" />
        </div>
      )}
      {selected ? (
        <div className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-[#007AFF] text-white">
          <Check className="size-3.5" strokeWidth={3} />
        </div>
      ) : null}
      {durationLabel ? (
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1 py-0.5 text-[11px] font-medium tabular-nums text-white">
          {durationLabel}
        </span>
      ) : null}
    </button>
  );
}

export function ContentMobileMediaGridSkeleton() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="size-8 animate-spin text-[#8E8E93]" />
    </div>
  );
}
