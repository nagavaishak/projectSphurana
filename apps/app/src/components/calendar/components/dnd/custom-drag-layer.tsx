import { parseISO } from 'date-fns';
import { useDragLayer } from 'react-dnd';

import { dragSnapState } from '@/components/calendar/components/dnd/drag-snap-state';
import { EventBlockBody } from '@/components/calendar/components/week-and-day-view/event-block-body';
import { HOUR_PX } from '@/components/calendar/constants';

import type { IEvent } from '@/components/calendar/interfaces';

interface IDragItem {
  event: IEvent;
  children: React.ReactNode;
  width: number;
  height: number;
  /** Vertical snap interval in px (18px = 15 min in the time-grid views). */
  snapY?: number;
  /** Horizontal snap interval in px (column width in the week view). */
  snapX?: number;
  /** Lock x to the source's initial position (day view: single column). */
  lockX?: boolean;
  /** Viewport-space bounds of the column grid for clamping the preview. */
  gridLeft?: number;
  gridRight?: number;
}

const PIXELS_PER_HOUR = HOUR_PX;

export function CustomDragLayer() {
  const {
    isDragging,
    item,
    currentOffset,
    initialOffset,
    initialClientOffset,
  } = useDragLayer((monitor) => ({
    item: monitor.getItem() as IDragItem | null,
    itemType: monitor.getItemType(),
    isDragging: monitor.isDragging(),
    currentOffset: monitor.getClientOffset(),
    initialOffset: monitor.getInitialSourceClientOffset(),
    initialClientOffset: monitor.getInitialClientOffset(),
  }));

  if (
    !isDragging ||
    !item ||
    !currentOffset ||
    !initialOffset ||
    !initialClientOffset
  ) {
    return null;
  }

  const offsetX = initialClientOffset.x - initialOffset.x;
  const offsetY = initialClientOffset.y - initialOffset.y;

  // Vertical: snap the preview's position to 15-min increments (snapY) so
  // the event jumps slot-by-slot as the cursor moves.
  // Horizontal: snap to whole day columns (snapX) so the preview clicks
  // onto a single column instead of floating between two.
  let top = currentOffset.y - offsetY;
  let snappedDeltaY = 0;
  if (item.snapY) {
    const deltaY = currentOffset.y - initialClientOffset.y;
    snappedDeltaY = Math.round(deltaY / item.snapY) * item.snapY;
    top = initialOffset.y + snappedDeltaY;
  }
  let left = currentOffset.x - offsetX;
  let snappedDeltaX = 0;
  if (item.lockX) {
    // Single-column view (day view): keep the preview pinned to the source's
    // original x. Without this, touch drags drift sideways on mobile because
    // there's no other column to snap into.
    left = initialOffset.x;
  } else if (item.snapX) {
    const deltaX = currentOffset.x - initialClientOffset.x;
    snappedDeltaX = Math.round(deltaX / item.snapX) * item.snapX;
    left = initialOffset.x + snappedDeltaX;
  }

  // Clamp the preview within the column grid's viewport bounds so it can't be
  // dragged past the leftmost / rightmost day in week view.
  if (item.gridLeft !== undefined && item.gridRight !== undefined) {
    const maxLeft = item.gridRight - item.width;
    if (maxLeft >= item.gridLeft) {
      left = Math.max(item.gridLeft, Math.min(left, maxLeft));
    }
  }

  // Publish the snapped deltas so drop handlers can read the exact value
  // the preview is rendering with — `monitor.getClientOffset()` at drop time
  // can lag the last hover by a few pixels, which puts the drop's threshold
  // out of sync with what the user sees.
  dragSnapState.snappedDeltaY = snappedDeltaY;
  dragSnapState.snappedDeltaX = snappedDeltaX;

  // Rebuild the preview body with the snapped time so the time labels in the
  // floating card track the slot it would land on.
  let previewBody: React.ReactNode = item.children;
  if (item.snapY) {
    const minutesMoved = (snappedDeltaY / PIXELS_PER_HOUR) * 60;
    const offsetMs = minutesMoved * 60_000;
    const previewEvent: IEvent = {
      ...item.event,
      startDate: new Date(
        parseISO(item.event.startDate).getTime() + offsetMs
      ).toISOString(),
      endDate: new Date(
        parseISO(item.event.endDate).getTime() + offsetMs
      ).toISOString(),
    };
    previewBody = <EventBlockBody event={previewEvent} />;
  }

  const layerStyles: React.CSSProperties = {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: 100,
    left,
    top,
  };

  return (
    <div style={layerStyles}>
      <div style={{ width: item.width, height: item.height }}>
        {previewBody}
      </div>
    </div>
  );
}
