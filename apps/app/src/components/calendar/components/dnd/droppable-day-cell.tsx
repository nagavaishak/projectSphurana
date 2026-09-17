import { differenceInMilliseconds, parseISO } from 'date-fns';
import { useEffect } from 'react';
import { useDrop } from 'react-dnd';

import { useCalendar } from '@/components/calendar/contexts/calendar-context';
import { useUpdateEvent } from '@/components/calendar/hooks/use-update-event';

import { ItemTypes } from '@/components/calendar/components/dnd/draggable-event';
import { ImpactStyle, hapticImpact, hapticSelection } from '@/lib/haptics';
import { zonedEvent, zonedWallTimeToUtc } from '@/lib/timezone';
import { cn } from '@/lib/utils';

import type { ICalendarCell, IEvent } from '@/components/calendar/interfaces';

interface DroppableDayCellProps {
  cell: ICalendarCell;
  children: React.ReactNode;
}

export function DroppableDayCell({ cell, children }: DroppableDayCellProps) {
  const { updateEvent } = useUpdateEvent();
  const { timeZone } = useCalendar();

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

        // Keep the event's wall-clock time (in the business timezone) on the
        // new day it was dropped onto.
        const zonedStart = zonedEvent(droppedEvent.startDate, timeZone);
        const newStartDate = zonedWallTimeToUtc(
          cell.date,
          zonedStart.getHours(),
          zonedStart.getMinutes(),
          timeZone
        );
        const newEndDate = new Date(newStartDate.getTime() + eventDurationMs);

        updateEvent(
          {
            ...droppedEvent,
            startDate: newStartDate.toISOString(),
            endDate: newEndDate.toISOString(),
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
    [cell.date, updateEvent, timeZone]
  );

  // Selection-tick haptic each time the drag enters this day cell.
  useEffect(() => {
    if (isOver && canDrop) hapticSelection();
  }, [isOver, canDrop]);

  return (
    <div
      ref={drop as unknown as React.RefObject<HTMLDivElement>}
      className={cn('h-full', isOver && canDrop && 'bg-accent/50')}
    >
      {children}
    </div>
  );
}
