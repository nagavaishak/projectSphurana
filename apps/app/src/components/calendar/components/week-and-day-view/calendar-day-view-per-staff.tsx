import { areIntervalsOverlapping, format, isToday, parseISO } from 'date-fns';
import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

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
import { useCalendar } from '@/components/calendar/contexts/calendar-context';

import {
  findResolvedShift,
  getEventBlockStyle,
  getVisibleHours,
  groupEvents,
  isHourDisabledForColumn,
} from '@/components/calendar/helpers';
import { useColumnMatcher } from '@/components/calendar/hooks/use-column-matcher';
import { zonedDateString } from '@/lib/timezone';
import { cn } from '@/lib/utils';

import type { IEvent, IUser } from '@/components/calendar/interfaces';
import type { CSSProperties } from 'react';

interface IProps {
  singleDayEvents: IEvent[];
  multiDayEvents: IEvent[];
}

const HEADER_PX = 96; // staff-avatar header + hours-rail spacer height
const MIN_COL_WIDTH = 160; // px — column basis before horizontal scroll kicks in

// Shared column sizing so the sticky header row and the scrolling body row
// stay aligned: grow to fill when few, never shrink below MIN_COL_WIDTH so
// many staff scroll horizontally instead of squashing.
const COL_STYLE: CSSProperties = { flex: `1 0 ${MIN_COL_WIDTH}px` };

/**
 * Per-staff day view: one column per visible staff member, with the staff
 * avatar + name above each column. This is the default desktop day layout
 * (Fresha-style) and the mobile day layout. Empty-slot taps pre-fill the new
 * booking with the column's practitionerId.
 *
 * Freeze-panes layout: a single scroll container holds a `sticky top-0` staff
 * header row and a `sticky left-0` hours rail, so headers stay pinned while the
 * grid scrolls vertically and the rail stays pinned while it scrolls
 * horizontally. Org-wide unavailability blocks (no practitioner) are duplicated
 * into every column so they remain visible everywhere.
 */
export function CalendarDayViewPerStaff({
  singleDayEvents,
  multiDayEvents,
}: IProps) {
  const {
    selectedDate,
    selectedUserIds,
    users,
    visibleHours,
    workingHours,
    resolvedShifts,
    config,
    timeZone,
  } = useCalendar();

  const DialogComponent = config.customAddDialog ?? AddEventDialog;

  const { hours, earliestEventHour, latestEventHour, firstEventHour } =
    getVisibleHours(visibleHours, singleDayEvents, timeZone);

  const firstHour = hours[0] ?? earliestEventHour;
  const lastHour = (hours[hours.length - 1] ?? latestEventHour) + 1;

  const selectedStaff =
    selectedUserIds === 'all'
      ? users
      : users.filter((u) => selectedUserIds.includes(u.id));

  // Filter to the selected day's events (by the event's business-timezone date).
  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
  const dayEvents = singleDayEvents.filter(
    (event) =>
      zonedDateString(parseISO(event.startDate), timeZone) === selectedDateStr
  );

  // A booking made for "Any team member" carries no practitioner, so it
  // matched no column and simply WAS NOT DRAWN — the diary looked empty for a
  // booking that exists. Give those events a column of their own, and only
  // when there are some, so a clinic that always assigns never sees it.
  const matchOrphan = useColumnMatcher();
  const orphanEvents = useMemo(
    () =>
      selectedUserIds === 'all'
        ? dayEvents.filter(
            (event) => !selectedStaff.some((staff) => matchOrphan(event, staff))
          )
        : [],
    [dayEvents, selectedStaff, selectedUserIds, matchOrphan]
  );

  const visibleStaff = useMemo(
    () =>
      orphanEvents.length > 0
        ? [...selectedStaff, UNASSIGNED_STAFF]
        : selectedStaff,
    [selectedStaff, orphanEvents.length]
  );

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

  if (visibleStaff.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        No team members selected
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DayViewMultiDayEventsRow
        selectedDate={selectedDate}
        multiDayEvents={multiDayEvents}
      />

      {/*
        `snap-x snap-mandatory` + `scroll-pl-16` make horizontal scrolling settle
        on a staff column (flush against the sticky hours rail) instead of
        drifting to an arbitrary offset. Vertical scrolling is unaffected.
      */}
      <div
        ref={scrollViewportRef}
        className="min-h-0 flex-1 snap-x snap-mandatory scroll-pl-16 overflow-auto"
      >
        {/* Staff header row — pinned to the top while the grid scrolls. */}
        <div className="sticky top-0 z-30 flex w-full bg-background">
          {/* Top-left corner — pinned to both edges. */}
          <div
            className="sticky left-0 z-40 w-16 shrink-0 border-r border-b bg-background"
            style={{ height: `${HEADER_PX}px` }}
          />
          {visibleStaff.map((staff) => (
            <StaffHeader key={staff.id} staff={staff} />
          ))}
        </div>

        {/* Body row — hours rail + staff columns. */}
        <div className="flex w-full">
          {/* Hours rail — pinned to the left while columns scroll sideways. */}
          <div className="sticky left-0 z-20 w-16 shrink-0 border-r bg-background">
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
              {isToday(selectedDate) && (
                <CalendarTimeline
                  variant="rail"
                  firstVisibleHour={firstHour}
                  lastVisibleHour={lastHour}
                />
              )}
            </div>
          </div>

          {visibleStaff.map((staff) => (
            <StaffColumn
              key={staff.id}
              staff={staff}
              hours={hours}
              firstHour={firstHour}
              lastHour={lastHour}
              dayEvents={dayEvents}
              earliestEventHour={earliestEventHour}
              latestEventHour={latestEventHour}
              workingHours={workingHours}
              shift={findResolvedShift(resolvedShifts, staff.id, selectedDate)}
              selectedDate={selectedDate}
              DialogComponent={DialogComponent}
              unassignedEvents={orphanEvents}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Synthetic column for bookings with no practitioner. Deliberately NOT a member
 * of `users`: that list feeds the team picker and every other consumer, none of
 * which should grow an "Unassigned" person.
 */
const UNASSIGNED_STAFF: IUser = {
  id: '__calendar_unassigned__',
  name: 'Unassigned',
  picturePath: null,
  userId: null,
  color: null,
};

function StaffHeader({ staff }: { staff: IUser }) {
  const { config } = useCalendar();
  const Menu = config.staffHeaderMenu;

  const initials = staff.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const inner = (
    <>
      <Avatar className="size-14">
        {staff.picturePath && (
          <AvatarImage src={staff.picturePath} alt={staff.name} />
        )}
        <AvatarFallback className="text-sm">{initials}</AvatarFallback>
      </Avatar>
      <span className="flex max-w-full items-center gap-0.5 px-2 text-sm font-medium text-foreground">
        <span className="truncate">{staff.name}</span>
        {Menu && <ChevronDown className="size-3.5 shrink-0 opacity-60" />}
      </span>
    </>
  );

  return (
    <div
      className="flex snap-start items-center justify-center border-l border-b"
      style={{ ...COL_STYLE, height: `${HEADER_PX}px` }}
    >
      {Menu ? (
        <Menu staff={staff}>
          <button
            type="button"
            className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md px-2 py-1 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {inner}
          </button>
        </Menu>
      ) : (
        <div className="flex flex-col items-center justify-center gap-1">
          {inner}
        </div>
      )}
    </div>
  );
}

interface StaffColumnProps {
  staff: IUser;
  hours: number[];
  firstHour: number;
  lastHour: number;
  dayEvents: IEvent[];
  earliestEventHour: number;
  latestEventHour: number;
  workingHours: ReturnType<typeof useCalendar>['workingHours'];
  shift: ReturnType<typeof findResolvedShift>;
  selectedDate: Date;
  DialogComponent: NonNullable<
    ReturnType<typeof useCalendar>['config']['customAddDialog']
  >;
  /** Events with no practitioner — drawn only in the Unassigned column. */
  unassignedEvents: IEvent[];
}

function StaffColumn({
  staff,
  hours,
  firstHour,
  lastHour,
  dayEvents,
  earliestEventHour,
  latestEventHour,
  workingHours,
  shift,
  selectedDate,
  DialogComponent,
  unassignedEvents,
}: StaffColumnProps) {
  const matchColumn = useColumnMatcher();
  const { timeZone } = useCalendar();
  // Events belonging to this resource column. Org-wide unavailability
  // (metadata.practitionerId === null) duplicates into every column so it
  // remains visible.
  const staffEvents =
    staff.id === UNASSIGNED_STAFF.id
      ? unassignedEvents
      : dayEvents.filter((e) => matchColumn(e, staff));

  const groupedEvents = groupEvents(staffEvents);

  return (
    <div className="relative snap-start border-l" style={COL_STYLE}>
      {hours.map((hour, index) => {
        const isDisabled = isHourDisabledForColumn(
          selectedDate,
          hour,
          workingHours,
          shift,
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

            {/* Out-of-shift hours are tinted with the hatched background but
                remain fully interactive: hovering shows the ghost create slot
                and clicking opens the add-appointment dialog, exactly like an
                open slot. Editing the shift itself is done via the staff icon
                menu at the top of the column. */}
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
                  practitionerId={staff.id}
                >
                  <HoverCreateSlot
                    top={slotIndex * SLOT_PX}
                    hour={hour}
                    minute={minute}
                  />
                </DialogComponent>
              </DroppableTimeBlock>
            ))}
          </div>
        );
      })}

      {/* Event blocks for this column */}
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

      {/* Now-indicator line for this column (time pill lives in the rail). */}
      {isToday(selectedDate) && (
        <CalendarTimeline
          variant="column"
          firstVisibleHour={firstHour}
          lastVisibleHour={lastHour}
        />
      )}
    </div>
  );
}
