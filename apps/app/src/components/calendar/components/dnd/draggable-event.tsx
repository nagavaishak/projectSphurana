import { useEffect, useRef } from 'react';
import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';

import { resetDragSnapState } from '@/components/calendar/components/dnd/drag-snap-state';
import { ImpactStyle, hapticImpact } from '@/lib/haptics';
import { cn } from '@/lib/utils';

import type { IEvent } from '@/components/calendar/interfaces';

export const ItemTypes = {
  EVENT: 'event',
};

interface DraggableEventProps {
  event: IEvent;
  children: React.ReactNode;
  /**
   * Pixel interval to snap the drag preview's vertical position to. Used by
   * the time-grid views (SLOT_PX = 15 min at HOUR_PX/hour) so the preview jumps in
   * fixed steps instead of following the cursor smoothly. Omitted in month
   * view, which falls back to smooth cursor tracking.
   */
  snapY?: number;
}

export function DraggableEvent({
  event,
  children,
  snapY,
}: DraggableEventProps) {
  const ref = useRef<HTMLDivElement>(null);

  // `event` MUST be in deps: without it the spec binds once on mount and the
  // `item` closure keeps emitting the first-render event, so dragging again
  // after a drop sends the pre-drop start/end (preview shows stale times and
  // the drop handler computes a delta off the wrong base).
  const [{ isDragging }, drag, preview] = useDrag(
    () => ({
      type: ItemTypes.EVENT,
      item: () => {
        // Reset before drag-layer's first render so a quick drop (no preview
        // frames between pickup and release) doesn't read leftover values
        // from the previous drag.
        resetDragSnapState();
        const width = ref.current?.offsetWidth || 0;
        const height = ref.current?.offsetHeight || 0;
        // If the source sits inside a `[data-day-column]` ancestor, capture
        // the column layout so the drag preview can snap horizontally instead
        // of drifting freely. Week view has multiple sibling columns → snap to
        // column width so the preview clicks between days. Day view has a
        // single column → lock x entirely so the preview can't drift off the
        // column on touch (where there's no other column to land on anyway).
        const columnEl =
          ref.current?.closest<HTMLElement>('[data-day-column]') ?? null;
        const gridEl = columnEl?.parentElement ?? null;
        const siblingColumnCount =
          gridEl?.querySelectorAll<HTMLElement>('[data-day-column]').length ??
          0;
        const snapX =
          siblingColumnCount > 1 ? columnEl?.offsetWidth : undefined;
        const lockX = siblingColumnCount === 1;
        const gridRect = gridEl?.getBoundingClientRect();
        const gridLeft = gridRect?.left;
        const gridRight = gridRect?.right;
        // Confirm the pickup with a medium haptic (no-op on web).
        hapticImpact(ImpactStyle.Medium);
        return {
          event,
          children,
          width,
          height,
          snapY,
          snapX,
          lockX,
          gridLeft,
          gridRight,
        };
      },
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }),
    [event, children, snapY]
  );

  // Hide the default drag preview
  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  drag(ref);

  return (
    <div ref={ref} className={cn(isDragging && 'opacity-40')}>
      {children}
    </div>
  );
}
