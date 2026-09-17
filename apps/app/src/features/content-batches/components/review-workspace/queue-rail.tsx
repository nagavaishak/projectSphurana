import { ImageIcon, VideoIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

import type { ContentItemWithAsset } from '../../types';
import { type ItemDotState, itemDotState, itemLabel } from './lib';

const DOT_CLASS: Record<ItemDotState, string> = {
  pending: 'bg-amber-500',
  accepted: 'bg-emerald-600',
  rejected: 'bg-muted-foreground/40',
  rendering: 'bg-sky-500 animate-pulse',
  failed: 'bg-destructive',
};

const DOT_LABEL: Record<ItemDotState, string> = {
  pending: 'Needs review',
  accepted: 'Scheduled',
  rejected: 'Rejected',
  rendering: 'Rendering',
  failed: 'Failed to render',
};

interface QueueRailProps {
  items: ContentItemWithAsset[];
  activeItemId: string | undefined;
  onSelect: (itemId: string) => void;
  /**
   * `full` — labelled list (wide desktop)
   * `strip` — numbered chips with status dots (narrow desktop)
   * `segments` — progress segments across the top (mobile)
   */
  variant: 'full' | 'strip' | 'segments';
}

/**
 * The queue.
 *
 * Its whole job is that "how much is left" is never a mystery — which is why
 * every item is always represented, including the ones already decided. A rail
 * that dropped accepted posts would shrink as you worked and destroy the sense
 * of progress it exists to give.
 */
export function QueueRail({
  items,
  activeItemId,
  onSelect,
  variant,
}: QueueRailProps) {
  const reviewed = items.filter((i) => i.reviewStatus !== 'pending').length;

  if (variant === 'segments') {
    return (
      <nav aria-label="Review queue" className="flex w-full items-center gap-1">
        {items.map((item, index) => {
          const state = itemDotState(item);
          const isActive = item.id === activeItemId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              aria-label={`${itemLabel(item, index)} — ${DOT_LABEL[state]}`}
              aria-current={isActive ? 'step' : undefined}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors',
                state === 'pending' && 'bg-muted',
                state === 'accepted' && 'bg-emerald-600',
                state === 'rejected' && 'bg-muted-foreground/30',
                state === 'rendering' && 'bg-sky-500',
                state === 'failed' && 'bg-destructive',
                isActive && 'ring-2 ring-primary ring-offset-1'
              )}
            />
          );
        })}
      </nav>
    );
  }

  if (variant === 'strip') {
    return (
      <ScrollArea className="h-full">
        <nav
          aria-label="Review queue"
          className="flex h-full w-14 flex-col items-center gap-1 py-2"
        >
          {items.map((item, index) => {
            const state = itemDotState(item);
            const isActive = item.id === activeItemId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                aria-label={`${itemLabel(item, index)} — ${DOT_LABEL[state]}`}
                aria-current={isActive ? 'true' : undefined}
                title={itemLabel(item, index)}
                className={cn(
                  'relative flex size-10 shrink-0 items-center justify-center rounded-md border text-xs tabular-nums transition-colors',
                  isActive
                    ? 'border-primary bg-primary/10 font-semibold text-primary'
                    : 'border-transparent text-muted-foreground hover:bg-muted'
                )}
              >
                {String(index + 1).padStart(2, '0')}
                <span
                  className={cn(
                    'absolute right-1 top-1 size-1.5 rounded-full',
                    DOT_CLASS[state]
                  )}
                />
              </button>
            );
          })}
        </nav>
      </ScrollArea>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between px-3 py-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Queue
        </p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {reviewed}/{items.length} reviewed
        </p>
      </div>
      <ScrollArea className="flex-1">
        <nav aria-label="Review queue" className="flex flex-col gap-0.5 p-1">
          {items.map((item, index) => {
            const state = itemDotState(item);
            const isActive = item.id === activeItemId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors',
                  isActive ? 'bg-muted' : 'hover:bg-muted/60'
                )}
              >
                <span className="mt-0.5 w-6 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {itemLabel(item, index)}
                  </span>
                  <span className="mt-1 flex items-center gap-1.5">
                    <span
                      className={cn('size-1.5 rounded-full', DOT_CLASS[state])}
                    />
                    <Badge
                      variant="outline"
                      className="h-4 gap-1 px-1 text-[10px] font-normal"
                    >
                      {item.kind === 'graphic' ? (
                        <ImageIcon className="size-2.5" />
                      ) : (
                        <VideoIcon className="size-2.5" />
                      )}
                      {item.kind === 'graphic' ? 'Graphic' : 'Video'}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {DOT_LABEL[state]}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </nav>
      </ScrollArea>
    </div>
  );
}
