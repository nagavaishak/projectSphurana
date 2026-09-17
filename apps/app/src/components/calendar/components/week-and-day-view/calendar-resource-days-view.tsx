import {
  addDays,
  areIntervalsOverlapping,
  format,
  isToday,
  parseISO,
  startOfWeek,
} from 'date-fns';
import { useEffect, useRef } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

import { AddEventDialog } from '@/components/calendar/components/dialogs/add-event-dialog';
import { EventDetailsDialog } from '@/components/calendar/components/dialogs/event-details-dialog';
import { DroppableTimeBlock } from '@/components/calendar/components/dnd/droppable-time-block';
import { CalendarTimeline } from '@/components/calendar/components/week-and-day-view/calendar-time-line';
import { DayViewMultiDayEventsRow } from '@/components/calendar/components/week-and-day-view/day-view-multi-day-events-row';
import { EventBlock } from '@/components/calendar/components/week-and-day-view/event-block';
import { eventBlockBodyVariants } from '@/components/calendar/components/week-and-day-view/event-block-body';
import { HoverCreateSlot } from '@/components/calendar/components/week-and-day-view/hover-create-slot';
import {
  HOUR_LABEL_OVERHANG_PX,
  HOUR_PX,
  SLOT_PX,
} from '@/components/calendar/constants';
import { useCalendar } from '@/components/calendar/contexts/calendar-context';
import { useGoToDayView } from '@/components/calendar/hooks/use-go-to-day-view';

import {
  findResolvedShift,
  getEventBlockStyle,
  getVisibleHours,
  groupEvents,
  isHourDisabledForColumn,
} from '@/components/calendar/helpers';
import { useColumnMatcher } from '@/components/calendar/hooks/use-column-matcher';
import { zonedDateString, zonedEvent } from '@/lib/timezone';
import { cn } from '@/lib/utils';

import type { IEvent, IUser } from '@/components/calendar/interfaces';
import type { CSSProperties } from 'react';

interface IProps {
  singleDayEvents: IEvent[];
  multiDayEvents: IEvent[];
  /** Number of day-columns to render (3 = "3 day", 7 = week). */
  dayCount: number;
}

const RAIL_W = 56; // px — hours rail width
const AVATAR_W = 96; // px — far-left person column width
const LIST_ROW_MIN = 160; // px — min height of a person row in list mode
const DAY_HEADER_PX = 56; // px — day header row height (sticky offset for avatar)

type DialogComponentType = NonNullable<
  ReturnType<typeof useCalendar>['config']['customAddDialog']
>;

/**
 * Resource × days grid used by the "3 day" / multi-day view.
 *
 * - One person selected → time grid: a far-left avatar column, a times column,
 *   then one time-grid column per day.
 * - Multiple people → no time column; people are rows, days are columns, and
 *   each person×day cell lists that person's bookings stacked as a list.
 *
 * Days are always the columns and people the rows.
 */
export function CalendarResourceDaysView({
  singleDayEvents,
  multiDayEvents,
  dayCount,
}: IProps) {
  const {
    selectedDate,
    selectedUserIds,
    users,
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
  const firstHour = hours[0] ?? earliestEventHour;
  const lastHour = (hours[hours.length - 1] ?? latestEventHour) + 1;

  const rangeStart = dayCount >= 7 ? startOfWeek(selectedDate) : selectedDate;
  const days = Array.from({ length: dayCount }, (_, i) =>
    addDays(rangeStart, i)
  );
  const gridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))`,
  };
  const hasToday = days.some((d) => isToday(d));

  const visibleStaff =
    selectedUserIds === 'all'
      ? users
      : users.filter((u) => selectedUserIds.includes(u.id));

  const isTimeline = visibleStaff.length <= 1;

  const scrollViewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport || !isTimeline) return;
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
  }, [earliestEventHour, firstEventHour, isTimeline]);

  if (visibleStaff.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        No team members selected
      </div>
    );
  }

  const cornerWidth = isTimeline ? AVATAR_W + RAIL_W : AVATAR_W;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DayViewMultiDayEventsRow
        selectedDate={selectedDate}
        multiDayEvents={multiDayEvents}
      />

      <div
        ref={scrollViewportRef}
        className="flex min-h-0 flex-1 flex-col overflow-auto"
      >
        {/* Day header row — pinned to the top. */}
        <div className="sticky top-0 z-30 flex shrink-0 border-b bg-background">
          <div
            className="sticky left-0 z-40 shrink-0 bg-background"
            style={{ width: cornerWidth }}
          />
          <div className="grid flex-1 divide-x border-l" style={gridStyle}>
            {days.map((day) => (
              <DayHeader key={format(day, 'yyyy-MM-dd')} day={day} />
            ))}
          </div>
        </div>

        {isTimeline ? (
          <TimelineBand
            staff={visibleStaff[0]}
            days={days}
            hours={hours}
            gridStyle={gridStyle}
            firstHour={firstHour}
            lastHour={lastHour}
            hasToday={hasToday}
            singleDayEvents={singleDayEvents}
            earliestEventHour={earliestEventHour}
            latestEventHour={latestEventHour}
            workingHours={workingHours}
            resolvedShifts={resolvedShifts}
            DialogComponent={DialogComponent}
            onEditOpeningHours={setEditOpeningHoursDate}
          />
        ) : (
          visibleStaff.map((staff) => (
            <ListRow
              key={staff.id}
              staff={staff}
              days={days}
              gridStyle={gridStyle}
              singleDayEvents={singleDayEvents}
              DialogComponent={DialogComponent}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DayHeader({ day }: { day: Date }) {
  const today = isToday(day);
  const goToDay = useGoToDayView();
  return (
    <button
      type="button"
      onClick={() => goToDay(day)}
      aria-label={`View ${format(day, 'EEEE, MMMM d')}`}
      className="flex w-full cursor-pointer items-center gap-2 px-3 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
      style={{ height: DAY_HEADER_PX }}
    >
      <span
        className={cn(
          'flex size-8 items-center justify-center rounded-full text-base font-semibold',
          today ? 'bg-primary text-primary-foreground' : 'text-foreground'
        )}
      >
        {format(day, 'd')}
      </span>
      <span
        className={cn(
          'text-base font-medium',
          today ? 'text-primary' : 'text-muted-foreground'
        )}
      >
        {format(day, 'EEEE')}
      </span>
    </button>
  );
}

function PersonAvatar({ staff }: { staff: IUser }) {
  const { config } = useCalendar();
  const Menu = config.staffHeaderMenu;
  const initials = staff.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const trigger = (
    <button
      type="button"
      className="flex flex-col items-center gap-1 rounded-md p-1 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    >
      <Avatar className="size-10">
        {staff.picturePath && (
          <AvatarImage src={staff.picturePath} alt={staff.name} />
        )}
        <AvatarFallback className="text-xs">{initials}</AvatarFallback>
      </Avatar>
      <span className="line-clamp-2 text-center text-xs font-medium leading-tight">
        {staff.name}
      </span>
    </button>
  );

  if (!Menu) return trigger;
  return <Menu staff={staff}>{trigger}</Menu>;
}

// ================= Timeline mode (single person) ================= //

interface TimelineBandProps {
  staff: IUser;
  days: Date[];
  hours: number[];
  gridStyle: CSSProperties;
  firstHour: number;
  lastHour: number;
  hasToday: boolean;
  singleDayEvents: IEvent[];
  earliestEventHour: number;
  latestEventHour: number;
  workingHours: ReturnType<typeof useCalendar>['workingHours'];
  resolvedShifts: ReturnType<typeof useCalendar>['resolvedShifts'];
  DialogComponent: DialogComponentType;
  onEditOpeningHours: (date: Date) => void;
}

function TimelineBand({
  staff,
  days,
  hours,
  gridStyle,
  firstHour,
  lastHour,
  hasToday,
  singleDayEvents,
  earliestEventHour,
  latestEventHour,
  workingHours,
  resolvedShifts,
  DialogComponent,
  onEditOpeningHours,
}: TimelineBandProps) {
  return (
    <div className="flex shrink-0">
      {/* Far-left avatar column — avatar pinned to the top so it stays
          visible while the day grids scroll vertically. */}
      <div
        className="sticky left-0 z-30 shrink-0 border-r bg-background"
        style={{ width: AVATAR_W }}
      >
        <div
          className="sticky flex flex-col items-center gap-1 p-2"
          style={{ top: DAY_HEADER_PX }}
        >
          <PersonAvatar staff={staff} />
        </div>
      </div>

      {/* Times column */}
      <div
        className="sticky z-20 shrink-0 border-r bg-background"
        style={{ width: RAIL_W, left: AVATAR_W }}
      >
        <div className="relative">
          {hours.map((hour, index) => (
            <div
              key={hour}
              className="relative"
              style={{ height: `${HOUR_PX}px` }}
            >
              <div className="absolute -top-2.5 right-2 flex h-5 items-center">
                {index !== 0 && (
                  <span className="text-xs font-medium text-muted-foreground">
                    {format(new Date().setHours(hour, 0, 0, 0), 'HH:mm')}
                  </span>
                )}
              </div>
            </div>
          ))}
          {hasToday && (
            <CalendarTimeline
              variant="rail"
              firstVisibleHour={firstHour}
              lastVisibleHour={lastHour}
            />
          )}
        </div>
      </div>

      {/* One time-grid column per day */}
      <div className="grid flex-1 divide-x border-l" style={gridStyle}>
        {days.map((day) => (
          <TimelineDayColumn
            key={format(day, 'yyyy-MM-dd')}
            staff={staff}
            day={day}
            hours={hours}
            firstHour={firstHour}
            lastHour={lastHour}
            singleDayEvents={singleDayEvents}
            earliestEventHour={earliestEventHour}
            latestEventHour={latestEventHour}
            workingHours={workingHours}
            resolvedShifts={resolvedShifts}
            DialogComponent={DialogComponent}
            onEditOpeningHours={onEditOpeningHours}
          />
        ))}
      </div>
    </div>
  );
}

interface TimelineDayColumnProps {
  staff: IUser;
  day: Date;
  hours: number[];
  firstHour: number;
  lastHour: number;
  singleDayEvents: IEvent[];
  earliestEventHour: number;
  latestEventHour: number;
  workingHours: ReturnType<typeof useCalendar>['workingHours'];
  resolvedShifts: ReturnType<typeof useCalendar>['resolvedShifts'];
  DialogComponent: DialogComponentType;
  onEditOpeningHours: (date: Date) => void;
}

function TimelineDayColumn({
  staff,
  day,
  hours,
  firstHour,
  lastHour,
  singleDayEvents,
  earliestEventHour,
  latestEventHour,
  workingHours,
  resolvedShifts,
  DialogComponent,
  onEditOpeningHours,
}: TimelineDayColumnProps) {
  const matchColumn = useColumnMatcher();
  const { timeZone } = useCalendar();
  const dayEvents = singleDayEvents.filter(
    (event) =>
      matchColumn(event, staff) &&
      (zonedDateString(parseISO(event.startDate), timeZone) ===
        format(day, 'yyyy-MM-dd') ||
        zonedDateString(parseISO(event.endDate), timeZone) ===
          format(day, 'yyyy-MM-dd'))
  );
  const groupedEvents = groupEvents(dayEvents);
  const dayShift = findResolvedShift(resolvedShifts, staff.id, day);

  return (
    <div className="relative">
      {hours.map((hour, index) => {
        const isDisabled = isHourDisabledForColumn(
          day,
          hour,
          workingHours,
          dayShift,
          { practitionerScoped: true }
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
                onClick={() => onEditOpeningHours(day)}
              />
            ) : (
              [0, 15, 30, 45].map((minute, slotIndex) => (
                <DroppableTimeBlock
                  key={minute}
                  date={day}
                  hour={hour}
                  minute={minute}
                >
                  <DialogComponent
                    startDate={day}
                    startTime={{ hour, minute }}
                    practitionerId={staff.id}
                  >
                    <HoverCreateSlot
                      top={slotIndex * SLOT_PX}
                      hour={hour}
                      minute={minute}
                    />
                  </DialogComponent>
                </DroppableTimeBlock>
              ))
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
          if (!hasOverlap) style = { ...style, width: '100%', left: '0%' };

          return (
            <div
              key={`${event.id}-${staff.id}`}
              className="absolute p-1"
              style={style}
              data-event-block
            >
              <EventBlock event={event} />
            </div>
          );
        })
      )}

      {isToday(day) && (
        <CalendarTimeline
          variant="column"
          firstVisibleHour={firstHour}
          lastVisibleHour={lastHour}
        />
      )}
    </div>
  );
}

// ================= List mode (multiple people) ================= //

interface ListRowProps {
  staff: IUser;
  days: Date[];
  gridStyle: CSSProperties;
  singleDayEvents: IEvent[];
  DialogComponent: DialogComponentType;
}

function ListRow({
  staff,
  days,
  gridStyle,
  singleDayEvents,
  DialogComponent,
}: ListRowProps) {
  return (
    <div className="flex flex-1 border-b" style={{ minHeight: LIST_ROW_MIN }}>
      <div
        className="sticky left-0 z-30 flex shrink-0 flex-col items-center justify-center gap-1 border-r bg-background p-2"
        style={{ width: AVATAR_W }}
      >
        <PersonAvatar staff={staff} />
      </div>

      <div className="grid flex-1 divide-x border-l" style={gridStyle}>
        {days.map((day) => (
          <ListCell
            key={format(day, 'yyyy-MM-dd')}
            staff={staff}
            day={day}
            singleDayEvents={singleDayEvents}
            DialogComponent={DialogComponent}
          />
        ))}
      </div>
    </div>
  );
}

interface ListCellProps {
  staff: IUser;
  day: Date;
  singleDayEvents: IEvent[];
  DialogComponent: DialogComponentType;
}

function ListCell({
  staff,
  day,
  singleDayEvents,
  DialogComponent,
}: ListCellProps) {
  const matchColumn = useColumnMatcher();
  const { timeZone } = useCalendar();
  const dayEvents = singleDayEvents
    .filter(
      (event) =>
        matchColumn(event, staff) &&
        zonedDateString(parseISO(event.startDate), timeZone) ===
          format(day, 'yyyy-MM-dd')
    )
    .sort(
      (a, b) =>
        parseISO(a.startDate).getTime() - parseISO(b.startDate).getTime()
    );

  return (
    <div className="relative h-full">
      {/* Background is an add-booking trigger; chips sit on top. */}
      <DialogComponent startDate={day} practitionerId={staff.id}>
        <button
          type="button"
          aria-label="Add booking"
          className="absolute inset-0 cursor-pointer transition-colors hover:bg-muted/30"
        />
      </DialogComponent>

      <div className="pointer-events-none relative flex flex-col gap-1 p-1.5">
        {dayEvents.map((event) => (
          <div key={`${event.id}-${staff.id}`} className="pointer-events-auto">
            <EventDetailsDialog event={event}>
              <button
                type="button"
                className={cn(
                  eventBlockBodyVariants({ color: event.color }),
                  'w-full text-left'
                )}
              >
                <span className="truncate font-medium">
                  {format(zonedEvent(event.startDate, timeZone), 'HH:mm')} -{' '}
                  {format(zonedEvent(event.endDate, timeZone), 'HH:mm')}{' '}
                  {event.title}
                </span>
              </button>
            </EventDetailsDialog>
          </div>
        ))}
      </div>
    </div>
  );
}
