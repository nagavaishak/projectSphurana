import { areIntervalsOverlapping, format, isToday, parseISO } from 'date-fns';
import {
  Calendar,
  Calendar as CalendarIcon,
  ChevronDown,
  Clock,
  User,
} from 'lucide-react';
import { useEffect, useRef } from 'react';

import { useCalendar } from '@/components/calendar/contexts/calendar-context';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SingleCalendar } from '@/components/ui/single-calendar';
import { useIsMobile } from '@/hooks/use-mobile';

import { AddEventDialog } from '@/components/calendar/components/dialogs/add-event-dialog';
import { DroppableTimeBlock } from '@/components/calendar/components/dnd/droppable-time-block';
import { CalendarTimeline } from '@/components/calendar/components/week-and-day-view/calendar-time-line';
import { DayViewMultiDayEventsRow } from '@/components/calendar/components/week-and-day-view/day-view-multi-day-events-row';
import { EventBlock } from '@/components/calendar/components/week-and-day-view/event-block';
import { HoverCreateSlot } from '@/components/calendar/components/week-and-day-view/hover-create-slot';
import {
  HOUR_LABEL_OVERHANG_PX,
  HOUR_PX,
  SLOT_PX,
} from '@/components/calendar/constants';

import {
  formatSelectionLabel,
  useDragToCreate,
} from '@/components/calendar/hooks/use-drag-to-create';

import {
  eventBelongsToPractitioner,
  findResolvedShift,
  getCurrentEvents,
  getEventBlockStyle,
  getVisibleHours,
  groupEvents,
  isHourDisabledForColumn,
} from '@/components/calendar/helpers';
import { zonedDateString, zonedEvent } from '@/lib/timezone';
import { cn } from '@/lib/utils';

import type { IEvent, IUser } from '@/components/calendar/interfaces';

const MOBILE_EVENT_BLOCK_CLASS =
  'rounded-[10px] border-transparent px-2.5 py-2 shadow-none [&_p:first-child]:text-[14px] [&_p:first-child]:font-bold [&_p:last-child]:text-[12px] [&_p:last-child]:opacity-80';

function formatMobileHourLabel(hour: number) {
  return `${String(hour).padStart(2, '0')}.00`;
}

function practitionerFirstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name;
}

interface IProps {
  singleDayEvents: IEvent[];
  multiDayEvents: IEvent[];
}

export function CalendarDayView({ singleDayEvents, multiDayEvents }: IProps) {
  const isMobile = useIsMobile();
  const {
    selectedDate,
    setSelectedDate,
    users,
    selectedUserId,
    visibleHours,
    workingHours,
    resolvedShifts,
    config,
    setEditOpeningHoursDate,
    timeZone,
  } = useCalendar();

  const DialogComponent = config.customAddDialog ?? AddEventDialog;

  const { hours, earliestEventHour, latestEventHour, firstEventHour } =
    getVisibleHours(visibleHours, singleDayEvents, timeZone);

  const currentEvents = getCurrentEvents(singleDayEvents);

  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
  const dayEvents = singleDayEvents.filter(
    (event) =>
      zonedDateString(parseISO(event.startDate), timeZone) === selectedDateStr
  );

  const groupedEvents = groupEvents(dayEvents);

  const scrollViewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    // Never scroll PAST the day's first booking. Defaulting straight to 09:00
    // parked an 08:30 appointment above the fold and bisected it against the
    // sticky header — the bottom few pixels of its text smeared along the edge.
    const preferred = isMobile ? Math.max(0, new Date().getHours() - 1) : 9;
    const targetHour =
      firstEventHour === undefined
        ? preferred
        : Math.min(preferred, firstEventHour);
    const offsetHours = Math.max(0, targetHour - earliestEventHour);
    // Clear the hour label's overhang so the topmost one isn't bisected by the
    // sticky header. See HOUR_LABEL_OVERHANG_PX.
    viewport.scrollTop = Math.max(
      0,
      offsetHours * HOUR_PX - HOUR_LABEL_OVERHANG_PX
    );
  }, [earliestEventHour, firstEventHour, isMobile]);

  const SecondaryDialogComponent = config.secondaryAddDialog;
  const { getColumnProps, selection, selectionStyle, pending, clearPending } =
    useDragToCreate({
      earliestEventHour,
      latestEventHour,
      visibleHours,
      enabled: !!SecondaryDialogComponent,
    });
  const dragProps = getColumnProps(selectedDate);

  const columnPractitioners: IUser[] =
    selectedUserId === 'all'
      ? users
      : users.filter((user) => user.id === selectedUserId);

  if (isMobile) {
    const practitioners =
      columnPractitioners.length > 0 ? columnPractitioners : users;
    const useMultiColumn = selectedUserId === 'all' && practitioners.length > 0;

    const mobileColumns = useMultiColumn
      ? practitioners.map((practitioner) => ({
          id: practitioner.id,
          events: dayEvents.filter((event) =>
            eventBelongsToPractitioner(event, practitioner)
          ),
        }))
      : [{ id: 'all', events: dayEvents }];

    const renderMobileDayColumn = (
      practitionerId: string | null,
      columnEvents: IEvent[]
    ) => {
      const columnGrouped = groupEvents(columnEvents);
      const columnPractitionerId =
        practitionerId ?? (selectedUserId !== 'all' ? selectedUserId : null);
      const columnShift = findResolvedShift(
        resolvedShifts,
        columnPractitionerId,
        selectedDate
      );

      return (
        <div
          key={practitionerId ?? 'all'}
          className="relative min-w-[120px] flex-1 border-l border-[#E5E5EA]"
        >
          <div className="relative select-none">
            {hours.map((hour, index) => {
              const isDisabled = isHourDisabledForColumn(
                selectedDate,
                hour,
                workingHours,
                columnShift,
                { practitionerScoped: columnPractitionerId != null }
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
                  {index !== 0 ? (
                    <div className="pointer-events-none absolute inset-x-0 top-0 border-b border-[#F2F2F7]" />
                  ) : null}

                  {!isDisabled ? (
                    <>
                      <DroppableTimeBlock
                        date={selectedDate}
                        hour={hour}
                        minute={0}
                      >
                        <DialogComponent
                          startDate={selectedDate}
                          startTime={{ hour, minute: 0 }}
                        >
                          <div
                            className="absolute inset-x-0 top-0 cursor-pointer"
                            style={{ height: `${SLOT_PX}px` }}
                          />
                        </DialogComponent>
                      </DroppableTimeBlock>
                      <DroppableTimeBlock
                        date={selectedDate}
                        hour={hour}
                        minute={30}
                      >
                        <DialogComponent
                          startDate={selectedDate}
                          startTime={{ hour, minute: 30 }}
                        >
                          <div
                            className="absolute inset-x-0 cursor-pointer"
                            style={{
                              top: `${SLOT_PX * 2}px`,
                              height: `${SLOT_PX}px`,
                            }}
                          />
                        </DialogComponent>
                      </DroppableTimeBlock>
                    </>
                  ) : (
                    <button
                      type="button"
                      aria-label="Edit opening hours"
                      className="absolute inset-0 cursor-pointer"
                      onClick={() => setEditOpeningHoursDate(selectedDate)}
                    />
                  )}
                </div>
              );
            })}

            {columnGrouped.map((group, groupIndex) =>
              group.map((event) => {
                let style = getEventBlockStyle(
                  event,
                  selectedDate,
                  groupIndex,
                  columnGrouped.length,
                  { from: earliestEventHour, to: latestEventHour },
                  timeZone
                );
                style = { ...style, width: '100%', left: '0%' };

                return (
                  <div
                    key={event.id}
                    className="absolute px-0.5"
                    style={style}
                    data-event-block
                  >
                    <EventBlock
                      event={event}
                      className={MOBILE_EVENT_BLOCK_CLASS}
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>
      );
    };

    return (
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white"
        data-mobile-calendar
      >
        <div className="shrink-0 px-4 pb-3 pt-1">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-2 text-[15px] font-medium text-[#0A0A0A]"
              >
                <CalendarIcon
                  className="size-[18px] text-[#525252]"
                  strokeWidth={2}
                />
                <span>{format(selectedDate, 'EEE d MMM')}</span>
                <ChevronDown
                  className="size-4 text-[#8E8E93]"
                  strokeWidth={2}
                />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-fit p-0">
              <SingleCalendar
                mode="single"
                selected={selectedDate}
                onSelect={setSelectedDate}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        </div>

        {useMultiColumn ? (
          <div className="flex shrink-0 border-b border-[#E5E5EA]">
            <div className="w-14 shrink-0" />
            {practitioners.map((practitioner) => (
              <div
                key={practitioner.id}
                className="flex min-w-0 flex-1 flex-col items-center gap-1.5 border-l border-[#E5E5EA] py-2.5"
              >
                <Avatar className="size-9 ring-2 ring-white">
                  {practitioner.picturePath ? (
                    <AvatarImage
                      src={practitioner.picturePath}
                      alt={practitioner.name}
                    />
                  ) : null}
                  <AvatarFallback className="bg-[#F2F2F7] text-[13px] font-semibold text-[#636366]">
                    {practitioner.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="max-w-full truncate px-1 text-[13px] font-medium text-[#0A0A0A]">
                  {practitionerFirstName(practitioner.name)}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <ScrollArea
          className="min-h-0 flex-1"
          type="always"
          viewportRef={scrollViewportRef}
        >
          <div className="flex">
            <div className="relative w-14 shrink-0">
              {hours.map((hour, index) => (
                <div
                  key={hour}
                  className="relative"
                  style={{ height: `${HOUR_PX}px` }}
                >
                  <div className="absolute -top-2.5 right-1 flex h-6 items-center">
                    {index !== 0 ? (
                      <span className="text-[12px] tabular-nums text-[#8E8E93]">
                        {formatMobileHourLabel(hour)}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <div className="relative flex min-w-0 flex-1 overflow-x-auto">
              {mobileColumns.map((column) =>
                renderMobileDayColumn(
                  column.id === 'all' ? null : column.id,
                  column.events
                )
              )}

              {isToday(selectedDate) && (
                <CalendarTimeline
                  firstVisibleHour={earliestEventHour}
                  lastVisibleHour={latestEventHour}
                  variant="mobile"
                />
              )}
            </div>
          </div>
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex flex-1 flex-col">
        <div>
          <DayViewMultiDayEventsRow
            selectedDate={selectedDate}
            multiDayEvents={multiDayEvents}
          />

          {/* Day header */}
          <div className="relative z-20 flex border-b">
            <div className="w-18" />
            <span className="flex-1 border-l py-2 text-center text-xs font-medium text-muted-foreground">
              {format(selectedDate, 'EE')}{' '}
              <span className="font-semibold text-foreground">
                {format(selectedDate, 'd')}
              </span>
            </span>
          </div>
        </div>

        <ScrollArea
          className="min-h-0 flex-1"
          type="always"
          viewportRef={scrollViewportRef}
        >
          <div className="flex">
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
                      <span className="text-xs text-muted-foreground">
                        {format(new Date().setHours(hour, 0, 0, 0), 'hh a')}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Day grid */}
            <div className="relative flex-1 border-l">
              <div
                className="relative select-none"
                data-day-column
                onPointerDown={dragProps.onPointerDown}
                onClickCapture={dragProps.onClickCapture}
              >
                {hours.map((hour, index) => {
                  const isDisabled = isHourDisabledForColumn(
                    selectedDate,
                    hour,
                    workingHours,
                    findResolvedShift(
                      resolvedShifts,
                      selectedUserId !== 'all' ? selectedUserId : null,
                      selectedDate
                    ),
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
                          onClick={() => setEditOpeningHoursDate(selectedDate)}
                        />
                      ) : (
                        <>
                          {[0, 15, 30, 45].map((minute, slotIndex) => (
                            <DroppableTimeBlock
                              key={minute}
                              date={selectedDate}
                              hour={hour}
                              minute={minute}
                            >
                              <DialogComponent
                                startDate={selectedDate}
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
                      selectedDate,
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

                {selection && selectionStyle && (
                  <div
                    className="pointer-events-none absolute inset-x-1 z-10 flex flex-col gap-0.5 rounded-md border border-neutral-200 bg-neutral-50 bg-unavailability-stripes px-2 py-1.5 text-xs text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                    style={selectionStyle}
                  >
                    <p className="truncate font-semibold">(No title)</p>
                    {selection.endMinutes - selection.startMinutes > 25 && (
                      <p>
                        {formatSelectionLabel(
                          selection.startMinutes,
                          selection.endMinutes
                        )}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {isToday(selectedDate) && (
                <CalendarTimeline
                  firstVisibleHour={earliestEventHour}
                  lastVisibleHour={latestEventHour}
                />
              )}
            </div>
          </div>
        </ScrollArea>

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
      </div>

      <div className="hidden w-72 divide-y border-l md:block">
        <SingleCalendar
          className="mx-auto w-fit"
          mode="single"
          selected={selectedDate}
          onSelect={setSelectedDate}
          initialFocus
        />

        <div className="flex-1 space-y-3">
          {currentEvents.length > 0 ? (
            <div className="flex items-start gap-2 px-4 pt-4">
              <span className="relative mt-[5px] flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex size-2.5 rounded-full bg-green-600" />
              </span>

              <p className="text-sm font-semibold text-foreground">
                Happening now
              </p>
            </div>
          ) : (
            <p className="p-4 text-center text-sm italic text-muted-foreground">
              No appointments or consultations at the moment
            </p>
          )}

          {currentEvents.length > 0 && (
            <ScrollArea className="h-[422px] px-4" type="always">
              <div className="space-y-6 pb-4">
                {currentEvents.map((event) => {
                  const user = users.find((user) => user.id === event.user.id);

                  return (
                    <div key={event.id} className="space-y-1.5">
                      <p className="line-clamp-2 text-sm font-semibold">
                        {event.title}
                      </p>

                      {user && (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <User className="size-3.5" />
                          <span className="text-sm">{user.name}</span>
                        </div>
                      )}

                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Calendar className="size-3.5" />
                        <span className="text-sm">
                          {format(new Date(), 'MMM d, yyyy')}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Clock className="size-3.5" />
                        <span className="text-sm">
                          {format(
                            zonedEvent(event.startDate, timeZone),
                            'h:mm a'
                          )}{' '}
                          -{' '}
                          {format(
                            zonedEvent(event.endDate, timeZone),
                            'h:mm a'
                          )}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    </div>
  );
}
