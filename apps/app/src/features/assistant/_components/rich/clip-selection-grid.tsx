import { Check, Film } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { VideoThumbnail } from '@/routes/_authed/create-video/$templateId/-components/shared/video-thumbnail';

interface AssetItem {
  id: string;
  name: string;
  type?: string;
  duration?: number | string | null;
  blobUrl?: string | null;
  thumbnailUrl?: string | null;
  tags?: string[] | null;
}

interface ClipSelectionGridProps {
  assets: AssetItem[];
  /** Called when the user confirms their selection */
  onConfirm: (selectedIds: string[]) => void;
}

function formatDuration(
  duration: number | string | null | undefined
): string | null {
  if (duration == null) return null;
  const seconds =
    typeof duration === 'string' ? Number.parseFloat(duration) : duration;
  if (Number.isNaN(seconds)) return null;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function ClipSelectionGrid({
  assets,
  onConfirm,
}: ClipSelectionGridProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (assets.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        No assets available. Upload some clips first.
      </div>
    );
  }

  return (
    <div className="w-full rounded-lg border bg-card p-4 sm:max-w-md">
      <p className="mb-3 text-sm font-medium">
        Select clips ({selected.size} selected)
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {assets.map((asset) => {
          const isSelected = selected.has(asset.id);
          const dur = formatDuration(asset.duration);

          return (
            <button
              key={asset.id}
              type="button"
              onClick={() => toggle(asset.id)}
              className={cn(
                'relative flex aspect-square items-center justify-center overflow-hidden rounded-md border-2 bg-muted transition-colors',
                isSelected
                  ? 'border-primary ring-1 ring-primary'
                  : 'border-transparent hover:border-muted-foreground/30'
              )}
            >
              {/* Thumbnail. `blobUrl` is the .mp4 — it can never paint in an
                  <img>, so a clip without a poster frame goes through
                  VideoThumbnail, same as the full clip picker. */}
              {asset.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={asset.thumbnailUrl}
                  alt={asset.name}
                  className="size-full object-cover"
                />
              ) : asset.blobUrl ? (
                <VideoThumbnail
                  src={asset.blobUrl}
                  className="size-full"
                  isImage={asset.type === 'image'}
                />
              ) : (
                <Film className="size-6 text-muted-foreground" />
              )}

              {/* Selection check */}
              {isSelected && (
                <div className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3" />
                </div>
              )}

              {/* Duration badge */}
              {dur && (
                <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[10px] text-white">
                  {dur}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <Button
        size="sm"
        className="mt-3 w-full"
        disabled={selected.size === 0}
        onClick={() => onConfirm(Array.from(selected))}
      >
        Confirm Selection ({selected.size})
      </Button>
    </div>
  );
}
