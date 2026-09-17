'use client';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Check, Play, Sparkles } from 'lucide-react';
import { type StockClipOption, useListStockClips } from '../api/stock-clips';

export function StockClipPicker({
  serviceId,
  selectedIds,
  onChange,
  maxSelectable,
}: {
  serviceId: string | null;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  maxSelectable?: number;
}) {
  const { stockClips, isLoading, isError } = useListStockClips({ serviceId });

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
      return;
    }
    if (maxSelectable && selectedIds.length >= maxSelectable) {
      onChange([...selectedIds.slice(1), id]);
      return;
    }
    onChange([...selectedIds, id]);
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-md" />
        ))}
      </div>
    );
  }

  if (isError || stockClips.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {serviceId
          ? 'No curated stock clips available for this service yet.'
          : 'No generic curated stock clips available yet.'}
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">
        {selectedIds.length} selected
        {maxSelectable ? ` · up to ${maxSelectable}` : ''} · pick the clips to
        use, or leave empty to auto-fill
      </p>
      <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4 md:grid-cols-5">
        {stockClips.map((clip) => (
          <StockClipTile
            key={clip.stockClipId}
            clip={clip}
            selected={selectedIds.includes(clip.stockClipId)}
            onClick={() => toggle(clip.stockClipId)}
          />
        ))}
      </div>
    </div>
  );
}

function StockClipTile({
  clip,
  selected,
  onClick,
}: {
  clip: StockClipOption;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={clip.description ?? undefined}
      className={cn(
        'group relative aspect-square overflow-hidden rounded-md border bg-muted text-left transition-all',
        selected
          ? 'border-primary ring-2 ring-primary'
          : 'border-transparent hover:border-border'
      )}
    >
      {clip.mediaType === 'video' ? (
        <video
          src={clip.previewUrl}
          className="size-full object-cover"
          muted
          playsInline
          preload="metadata"
          onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
          onMouseLeave={(e) => {
            e.currentTarget.pause();
            e.currentTarget.currentTime = 0;
          }}
        />
      ) : (
        <img
          src={clip.previewUrl}
          alt={clip.description ?? 'Stock clip'}
          className="size-full object-cover"
        />
      )}

      {clip.mediaType === 'video' && !selected && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-white/80 opacity-70 transition-opacity group-hover:opacity-0">
          <Play className="size-5 drop-shadow" />
        </div>
      )}

      {!clip.isGeneric && (
        <Badge
          variant="secondary"
          className="pointer-events-none absolute left-1 top-1 gap-1 px-1 py-0 text-[9px]"
        >
          <Sparkles className="size-2.5" />
          Match
        </Badge>
      )}

      {selected && (
        <div className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
          <Check className="size-3" />
        </div>
      )}
    </button>
  );
}
