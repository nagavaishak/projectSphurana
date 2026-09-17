import { useNavigate } from '@tanstack/react-router';
import { isToday, startOfDay } from 'date-fns';
import { useMemo } from 'react';

import { useCalendar } from '@/components/calendar/contexts/calendar-context';

import { AddEventDialog } from '@/components/calendar/components/dialogs/add-event-dialog';
import { DroppableDayCell } from '@/components/calendar/components/dnd/droppable-day-cell';
import { EventBullet } from '@/components/calendar/components/month-view/event-bullet';
import { MonthEventBadge } from '@/components/calendar/components/month-view/month-event-badge';

import { getMonthCellEvents } from '@/components/calendar/helpers';
import { cn } from '@/lib/utils';

import type { ICalendarCell, IEvent } from '@/components/calendar/interfaces';

interface IProps {
  cell: ICalendarCell;
  events: IEvent[];
  eventPositions: Record<string, number>;
}

const MAX_VISIBLE_EVENTS = 3;

export function DayCell({ cell, events, eventPositions }: IProps) {
  const { config, setSelectedDate, timeZone } = useCalendar();
  const navigate = useNavigate();

  const { day, currentMonth, date } = cell;

  const cellEvents = useMemo(
    () => getMonthCellEvents(date, events, eventPositions, timeZone),
    [date, events, eventPositions, timeZone]
  );
  const isSunday = date.getDay() === 0;

  const DialogComponent = config.customAddDialog ?? AddEventDialog;

  // Appointments calendar: clicking a day opens that day's per-staff view
  // instead of the add dialog. Other calendars keep the add-on-click flow.
  const navigateToDay = config.navigateToDayOnMonthCellClick
    ? () => {
        setSelectedDate(date);
        navigate({ to: `${config.routerBasePath ?? ''}/day` as never });
      }
    : null;

  const dayButtonClassName = cn(
    'flex size-6 translate-x-1 items-center justify-center rounded-full text-xs font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring lg:px-2',
    !currentMonth && 'opacity-20',
    isToday(date) &&
      'bg-primary font-bold text-primary-foreground hover:bg-primary'
  );

  return (
    <DroppableDayCell cell={cell}>
      <div
        className={cn(
          'flex h-full flex-col gap-1 border-l border-t py-1.5 transition-colors hover:bg-muted/40 lg:pb-2 lg:pt-1',
          isSunday && 'border-l-0'
        )}
      >
        {navigateToDay ? (
          <button
            type="button"
            onClick={navigateToDay}
            className={dayButtonClassName}
          >
            {day}
          </button>
        ) : (
          <DialogComponent startDate={date}>
            <button type="button" className={dayButtonClassName}>
              {day}
            </button>
          </DialogComponent>
        )}

        <div
          className={cn(
            'flex h-6 gap-1 px-2 lg:h-[94px] lg:flex-col lg:gap-2 lg:px-0',
            !currentMonth && 'opacity-50'
          )}
        >
          {[0, 1, 2].map((position) => {
            const event = cellEvents.find((e) => e.position === position);
            const eventKey = event
              ? `event-${event.id}-${position}`
              : `empty-${position}`;

            return (
              <div key={eventKey} className="lg:flex-1">
                {event ? (
                  <>
                    <EventBullet className="lg:hidden" color={event.color} />
                    <MonthEventBadge
                      className="hidden lg:flex"
                      event={event}
                      cellDate={startOfDay(date)}
                    />
                  </>
                ) : navigateToDay ? (
                  <button
                    type="button"
                    aria-label={`Open ${date.toDateString()}`}
                    onClick={navigateToDay}
                    className="h-full w-full cursor-pointer"
                  />
                ) : (
                  <DialogComponent startDate={date}>
                    <div className="h-full w-full cursor-pointer" />
                  </DialogComponent>
                )}
              </div>
            );
          })}
        </div>

        {cellEvents.length > MAX_VISIBLE_EVENTS && (
          <p
            className={cn(
              'h-4.5 px-1.5 text-xs font-semibold text-muted-foreground',
              !currentMonth && 'opacity-50'
            )}
          >
            <span className="sm:hidden">
              +{cellEvents.length - MAX_VISIBLE_EVENTS}
            </span>
            <span className="hidden sm:inline">
              {' '}
              {cellEvents.length - MAX_VISIBLE_EVENTS} more...
            </span>
          </p>
        )}
      </div>
    </DroppableDayCell>
  );
}
