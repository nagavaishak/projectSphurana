import { cn } from '@/lib/utils';
import { Check, Loader2 } from 'lucide-react';

import {
  formatAssetDurationSeconds,
  formatVideoDurationMs,
} from './ad-mobile-format';

export interface AdMobileVideoItem {
  id: string;
  thumbnailUrl: string | null;
  blobUrl: string | null;
  durationMs?: string | number | null;
  durationSeconds?: string | number | null;
  isVideoPreview?: boolean;
}

interface AdMobileVideoThumbProps {
  item: AdMobileVideoItem;
  selected: boolean;
  onSelect: () => void;
}

export function AdMobileVideoThumb({
  item,
  selected,
  onSelect,
}: AdMobileVideoThumbProps) {
  const durationLabel =
    formatVideoDurationMs(item.durationMs) ??
    formatAssetDurationSeconds(item.durationSeconds);

  return (
    <button
      type="button"
      onClick={onSelect}
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
      ) : item.blobUrl && item.isVideoPreview !== false ? (
        // No poster yet: paint a real first frame. The `#t=0.1` media fragment
        // makes browsers seek+paint without JS; the metadata seek covers the
        // rest. Without this the bare <video> stays blank (an empty grey tile).
        <video
          src={`${item.blobUrl}#t=0.1`}
          className="size-full object-cover"
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => {
            try {
              e.currentTarget.currentTime = 0.1;
            } catch {
              // Some browsers reject an early seek; the #t=0.1 fragment covers them.
            }
          }}
        />
      ) : (
        <div className="flex size-full items-center justify-center text-[13px] text-[#8E8E93]">
          No preview
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

export function AdMobileVideoGridSkeleton() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="size-8 animate-spin text-[#8E8E93]" />
    </div>
  );
}
