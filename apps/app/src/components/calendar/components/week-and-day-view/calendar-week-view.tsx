import {
  addDays,
  areIntervalsOverlapping,
  format,
  isSameDay,
  isToday,
  parseISO,
  startOfWeek,
} from 'date-fns';
import { useEffect, useRef } from 'react';

import { useCalendar } from '@/components/calendar/contexts/calendar-context';

import { ScrollArea } from '@/components/ui/scroll-area';

import { AddEventDialog } from '@/components/calendar/components/dialogs/add-event-dialog';
import { DroppableTimeBlock } from '@/components/calendar/components/dnd/droppable-time-block';
import { CalendarTimeline } from '@/components/calendar/components/week-and-day-view/calendar-time-line';
import { EventBlock } from '@/components/calendar/components/week-and-day-view/event-block';
import { HoverCreateSlot } from '@/components/calendar/components/week-and-day-view/hover-create-slot';
import { WeekViewMultiDayEventsRow } from '@/components/calendar/components/week-and-day-view/week-view-multi-day-events-row';
import {
  HOUR_LABEL_OVERHANG_PX,
  HOUR_PX,
  SLOT_PX,
} from '@/components/calendar/constants';
import { useGoToDayView } from '@/components/calendar/hooks/use-go-to-day-view';

import {
  formatSelectionLabel,
  useDragToCreate,
} from '@/components/calendar/hooks/use-drag-to-create';

import {
  findResolvedShift,
  getEventBlockStyle,
  getVisibleHours,
  groupEvents,
  isHourDisabledForColumn,
} from '@/components/calendar/helpers';
import { zonedDateString } from '@/lib/timezone';
import { cn } from '@/lib/utils';

import type { IEvent } from '@/components/calendar/interfaces';

interface IProps {
  singleDayEvents: IEvent[];
  multiDayEvents: IEvent[];
}

export function CalendarWeekView({ singleDayEvents, multiDayEvents }: IProps) {
  const {
    selectedDate,
    selectedUserId,
    workingHours,
    resolvedShifts,
    visibleHours,
    config,
    setEditOpeningHoursDate,
    timeZone,
  } = useCalendar();

  const DialogComponent = config.customAddDialog ?? AddEventDialog;

  const { hours, earliestEventHour, latestEventHour, firstEventHour } =
    getVisibleHours(visibleHours, singleDayEvents, timeZone);

  const weekStart = startOfWeek(selectedDate);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const goToDay = useGoToDayView();

  const scrollViewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    // Never scroll PAST the day's first booking. Defaulting straight to 09:00
    // parked an 08:30 appointment above the fold and bisected it against the
    // sticky header — the bottom few pixels of its text smeared along the edge.
    const targetHour =
      firstEventHour === undefined ? 9 : Math.min(9, firstEventHour);
    const offsetHours = Math.max(0, targetHour - earliestEventHour);
    // Clear the hour label's overhang so the topmost one isn't bisected by the
    // sticky header. See HOUR_LABEL_OVERHANG_PX.
    viewport.scrollTop = Math.max(
      0,
      offsetHours * HOUR_PX - HOUR_LABEL_OVERHANG_PX
    );
  }, [earliestEventHour, firstEventHour]);

  const SecondaryDialogComponent = config.secondaryAddDialog;
  const { getColumnProps, selection, selectionStyle, pending, clearPending } =
    useDragToCreate({
      earliestEventHour,
      latestEventHour,
      visibleHours,
      enabled: !!SecondaryDialogComponent,
    });

  return (
    <>
      <div className="flex flex-col items-center justify-center border-b py-4 text-sm text-muted-foreground sm:hidden">
        <p>Weekly view is not available on smaller devices.</p>
        <p>Please switch to daily or monthly view.</p>
      </div>

      <div className="hidden min-h-0 flex-1 flex-col sm:flex">
        <div>
          <WeekViewMultiDayEventsRow
            selectedDate={selectedDate}
            multiDayEvents={multiDayEvents}
          />

          {/* Week header */}
          <div className="relative z-20 flex border-b">
            <div className="w-18" />
            <div className="grid flex-1 grid-cols-7 divide-x border-l">
              {weekDays.map((day) => (
                <button
                  key={format(day, 'yyyy-MM-dd')}
                  type="button"
                  onClick={() => goToDay(day)}
                  aria-label={`View ${format(day, 'EEEE, MMMM d')}`}
                  className="cursor-pointer py-2 text-center text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {format(day, 'EE')}{' '}
                  <span className="ml-1 font-semibold text-foreground">
                    {format(day, 'd')}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <ScrollArea
          className="min-h-0 flex-1"
          type="always"
          viewportRef={scrollViewportRef}
        >
          <div className="flex overflow-hidden">
            {/* Hours column */}
            <div className="relative w-18">
              {hours.map((hour, index) => (
                <div
                  key={hour}
                  className="relative"
                  style={{ height: `${HOUR_PX}px` }}
                >
                  <div className="absolute -top-3 right-2 flex h-6 items-center">
                    {index !== 0 && (
                      <span className="text-xs font-medium text-muted-foreground">
                        {format(new Date().setHours(hour, 0, 0, 0), 'HH:mm')}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {weekDays.some((day) => isToday(day)) && (
                <CalendarTimeline
                  variant="rail"
                  firstVisibleHour={earliestEventHour}
                  lastVisibleHour={latestEventHour}
                />
              )}
            </div>

            {/* Week grid */}
            <div className="relative flex-1 border-l">
              <div className="grid grid-cols-7 divide-x">
                {weekDays.map((day) => {
                  const dayStr = format(day, 'yyyy-MM-dd');
                  const dayEvents = singleDayEvents.filter(
                    (event) =>
                      zonedDateString(parseISO(event.startDate), timeZone) ===
                        dayStr ||
                      zonedDateString(parseISO(event.endDate), timeZone) ===
                        dayStr
                  );
                  const groupedEvents = groupEvents(dayEvents);
                  const dayShift = findResolvedShift(
                    resolvedShifts,
                    selectedUserId !== 'all' ? selectedUserId : null,
                    day
                  );

                  const dragProps = getColumnProps(day);
                  const isDayActive =
                    selection !== null && isSameDay(selection.day, day);

                  return (
                    <div
                      key={format(day, 'yyyy-MM-dd')}
                      className="relative select-none"
                      data-day-column
                      onPointerDown={dragProps.onPointerDown}
                      onClickCapture={dragProps.onClickCapture}
                    >
                      {hours.map((hour, index) => {
                        const isDisabled = isHourDisabledForColumn(
                          day,
                          hour,
                          workingHours,
                          dayShift,
                          { practitionerScoped: selectedUserId !== 'all' }
                        );

                        return (
                          <div
                            key={hour}
                            className={cn(
                              'relative',
                              isDisabled && 'bg-calendar-disabled-hour'
                            )}
                            style={{ height: `${HOUR_PX}px` }}
                          >
                            {index !== 0 && (
                              <div className="pointer-events-none absolute inset-x-0 top-0 border-b" />
                            )}

                            {isDisabled ? (
                              <button
                                type="button"
                                aria-label="Edit opening hours"
                                className="absolute inset-0 cursor-pointer transition-colors hover:bg-muted/40"
                                onClick={() => setEditOpeningHoursDate(day)}
                              />
                            ) : (
                              <>
                                {[0, 15, 30, 45].map((minute, slotIndex) => (
                                  <DroppableTimeBlock
                                    key={minute}
                                    date={day}
                                    hour={hour}
                                    minute={minute}
                                  >
                                    <DialogComponent
                                      startDate={day}
                                      startTime={{ hour, minute }}
                                    >
                                      <HoverCreateSlot
                                        top={slotIndex * SLOT_PX}
                                        hour={hour}
                                        minute={minute}
                                      />
                                    </DialogComponent>
                                  </DroppableTimeBlock>
                                ))}
                              </>
                            )}
                          </div>
                        );
                      })}

                      {groupedEvents.map((group, groupIndex) =>
                        group.map((event) => {
                          let style = getEventBlockStyle(
                            event,
                            day,
                            groupIndex,
                            groupedEvents.length,
                            { from: earliestEventHour, to: latestEventHour },
                            timeZone
                          );
                          const hasOverlap = groupedEvents.some(
                            (otherGroup, otherIndex) =>
                              otherIndex !== groupIndex &&
                              otherGroup.some((otherEvent) =>
                                areIntervalsOverlapping(
                                  {
                                    start: parseISO(event.startDate),
                                    end: parseISO(event.endDate),
                                  },
                                  {
                                    start: parseISO(otherEvent.startDate),
                                    end: parseISO(otherEvent.endDate),
                                  }
                                )
                              )
                          );

                          if (!hasOverlap)
                            style = { ...style, width: '100%', left: '0%' };

                          return (
                            <div
                              key={event.id}
                              className="absolute p-1"
                              style={style}
                              data-event-block
                            >
                              <EventBlock event={event} />
                            </div>
                          );
                        })
                      )}

                      {isDayActive && selectionStyle && (
                        <div
                          className="pointer-events-none absolute inset-x-1 z-10 flex flex-col gap-0.5 rounded-md border border-neutral-200 bg-neutral-50 bg-unavailability-stripes px-2 py-1.5 text-xs text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                          style={selectionStyle}
                        >
                          <p className="truncate font-semibold">(No title)</p>
                          {selection &&
                            selection.endMinutes - selection.startMinutes >
                              25 && (
                              <p>
                                {formatSelectionLabel(
                                  selection.startMinutes,
                                  selection.endMinutes
                                )}
                              </p>
                            )}
                        </div>
                      )}

                      {isToday(day) && (
                        <CalendarTimeline
                          variant="column"
                          firstVisibleHour={earliestEventHour}
                          lastVisibleHour={latestEventHour}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>

      {SecondaryDialogComponent && pending && (
        <SecondaryDialogComponent
          open
          onOpenChange={(next) => {
            if (!next) clearPending();
          }}
          startDate={pending.startDate}
          startTime={pending.startTime}
          endTime={pending.endTime}
        />
      )}
    </>
  );
}
