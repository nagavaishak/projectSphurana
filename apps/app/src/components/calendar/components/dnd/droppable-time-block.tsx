import { differenceInMilliseconds, parseISO } from 'date-fns';
import { useEffect } from 'react';
import { useDrop } from 'react-dnd';

import { useCalendar } from '@/components/calendar/contexts/calendar-context';
import { useUpdateEvent } from '@/components/calendar/hooks/use-update-event';

import { dragSnapState } from '@/components/calendar/components/dnd/drag-snap-state';
import { ItemTypes } from '@/components/calendar/components/dnd/draggable-event';
import { HOUR_PX, SLOT_PX } from '@/components/calendar/constants';
import { clampEventToVisibleHours } from '@/components/calendar/helpers';
import { ImpactStyle, hapticImpact, hapticSelection } from '@/lib/haptics';
import { zonedEvent, zonedWallTimeToUtc } from '@/lib/timezone';
import { cn } from '@/lib/utils';

import type { IEvent } from '@/components/calendar/interfaces';

const PIXELS_PER_HOUR = HOUR_PX;

interface DroppableTimeBlockProps {
  date: Date;
  hour: number;
  minute: number;
  children: React.ReactNode;
}

export function DroppableTimeBlock({
  date,
  hour,
  minute,
  children,
}: DroppableTimeBlockProps) {
  const { updateEvent } = useUpdateEvent();
  const { visibleHours, timeZone } = useCalendar();

  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: ItemTypes.EVENT,
      drop: (item: { event: IEvent }) => {
        const droppedEvent = item.event;

        const eventStartDate = parseISO(droppedEvent.startDate);
        const eventEndDate = parseISO(droppedEvent.endDate);

        const eventDurationMs = differenceInMilliseconds(
          eventEndDate,
          eventStartDate
        );

        // Read the snapped delta from the value CustomDragLayer last rendered
        // with, NOT from `monitor.getClientOffset()` at drop time: react-dnd's
        // cursor in the drop handler can be a few pixels behind the last
        // hover, which puts the drop's snap threshold out of sync with what
        // the preview shows. We also ignore the slot's `hour`/`minute` here —
        // they'd only line up if the user always grabbed events from the top.
        const minutesDelta =
          (dragSnapState.snappedDeltaY / PIXELS_PER_HOUR) * 60;

        // `date` is the dropped column's day so cross-column week-view drags
        // land on the new day; the time comes from the event's original
        // wall-clock (in the BUSINESS timezone) + the dragged delta.
        const zonedStart = zonedEvent(droppedEvent.startDate, timeZone);
        const base = zonedWallTimeToUtc(
          date,
          zonedStart.getHours(),
          zonedStart.getMinutes(),
          timeZone
        );
        const newStartDate = new Date(
          base.getTime() + minutesDelta * 60 * 1000
        );

        const naiveEnd = new Date(newStartDate.getTime() + eventDurationMs);

        // Clamp into the user-configured visible-hours window so a 30-min
        // event dropped at 11:45 with a 12pm cutoff snaps to 11:30–12:00
        // instead of bleeding past the calendar's bottom and triggering
        // the visible-range auto-expand in getVisibleHours.
        const { startDate: clampedStart, endDate: clampedEnd } =
          clampEventToVisibleHours(newStartDate, naiveEnd, visibleHours);

        updateEvent(
          {
            ...droppedEvent,
            startDate: clampedStart.toISOString(),
            endDate: clampedEnd.toISOString(),
          },
          { isDragDrop: true }
        );

        // Light impact on a successful drop.
        hapticImpact(ImpactStyle.Light);
        return { moved: true };
      },
      collect: (monitor) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
    }),
    [date, hour, minute, updateEvent, visibleHours, timeZone]
  );

  // Selection-tick haptic each time the drag enters this 15-min slot.
  useEffect(() => {
    if (isOver && canDrop) hapticSelection();
  }, [isOver, canDrop]);

  return (
    <div
      ref={drop as unknown as React.RefObject<HTMLDivElement>}
      className={cn(isOver && canDrop && 'bg-accent/50')}
      style={{ height: `${SLOT_PX}px` }}
    >
      {children}
    </div>
  );
}
