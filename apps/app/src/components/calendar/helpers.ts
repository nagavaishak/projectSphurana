import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  differenceInDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  isWithinInterval,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns';

import {
  zonedDateString,
  zonedEvent,
  zonedMinutesOfDay,
  zonedStartOfDayUtc,
} from '@/lib/timezone';

import type { ICalendarCell, IEvent } from '@/components/calendar/interfaces';
import type {
  TCalendarView,
  TResolvedShift,
  TVisibleHours,
  TWorkingHours,
} from '@/components/calendar/types';

// ================ Header helper functions ================ //

export function rangeText(view: TCalendarView, date: Date) {
  const formatString = 'MMM d, yyyy';
  let start: Date;
  let end: Date;

  switch (view) {
    case 'agenda':
      start = startOfMonth(date);
      end = endOfMonth(date);
      break;
    case 'year':
      start = startOfYear(date);
      end = endOfYear(date);
      break;
    case 'month':
      start = startOfMonth(date);
      end = endOfMonth(date);
      break;
    case 'week':
      start = startOfWeek(date);
      end = endOfWeek(date);
      break;
    case '3day':
      start = date;
      end = addDays(date, 2);
      break;
    case 'day':
      return format(date, formatString);
    default:
      return 'Error while formatting ';
  }

  return `${format(start, formatString)} - ${format(end, formatString)}`;
}

export function navigateDate(
  date: Date,
  view: TCalendarView,
  direction: 'previous' | 'next'
): Date {
  const sign = direction === 'next' ? 1 : -1;
  switch (view) {
    case 'agenda':
    case 'month':
      return addMonths(date, sign);
    case 'year':
      return addYears(date, sign);
    case 'week':
      return addWeeks(date, sign);
    case '3day':
      return addDays(date, sign * 3);
    default:
      return addDays(date, sign);
  }
}

/**
 * The half-open instant window `[start, end)` a view covers, resolved in the
 * BUSINESS timezone.
 *
 * SINGLE SOURCE OF TRUTH for "which events belong to this view" — the event
 * filter and the header's event count both read it, so a count can never
 * disagree with what the grid renders.
 *
 * Only the LOCAL year/month/date of `date` are meaningful; it names a calendar
 * day, not an instant. Day arithmetic stays on that local date (`new Date(y, m,
 * d + n)` normalises month and year rollover) and converts ONCE at the end, so
 * a DST-shortened day is still exactly one day.
 *
 * Building these bounds browser-locally is the bug this replaces: it filed
 * every event under the VIEWER's day, so an operator in a different zone from
 * the org saw an empty grid while the API had returned the rows.
 */
export function getViewRange(
  date: Date,
  view: TCalendarView,
  timeZone: string
): { start: Date; end: Date } {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  const from = (target: Date) => zonedStartOfDayUtc(target, timeZone);

  switch (view) {
    case 'year':
      return {
        start: from(new Date(y, 0, 1)),
        end: from(new Date(y + 1, 0, 1)),
      };
    case 'month':
    case 'agenda':
      return {
        start: from(new Date(y, m, 1)),
        end: from(new Date(y, m + 1, 1)),
      };
    case '3day':
      return {
        start: from(new Date(y, m, d)),
        end: from(new Date(y, m, d + 3)),
      };
    case 'week': {
      const weekStart = d - date.getDay();
      return {
        start: from(new Date(y, m, weekStart)),
        end: from(new Date(y, m, weekStart + 7)),
      };
    }
    default:
      return {
        start: from(new Date(y, m, d)),
        end: from(new Date(y, m, d + 1)),
      };
  }
}

/**
 * How many events START inside the current view, for the header badge.
 *
 * Counts by start instant against {@link getViewRange}, so the badge and the
 * grid always agree. Note the 3-day view now counts THREE days: it previously
 * borrowed the week comparison, which reported events the view never showed.
 */
export function getEventsCount(
  events: IEvent[],
  date: Date,
  view: TCalendarView,
  timeZone: string
): number {
  const { start, end } = getViewRange(date, view, timeZone);
  return events.filter((event) => {
    const eventStart = parseISO(event.startDate);
    return eventStart >= start && eventStart < end;
  }).length;
}

// ================ Week and day view helper functions ================ //

export function getCurrentEvents(events: IEvent[]) {
  const now = new Date();
  return (
    events.filter((event) =>
      isWithinInterval(now, {
        start: parseISO(event.startDate),
        end: parseISO(event.endDate),
      })
    ) || null
  );
}

type PractitionerColumn = Pick<IEvent['user'], 'id'> & {
  userId?: string | null;
};

/**
 * Whether an event is a time BLOCK (not a bookable appointment).
 *
 * The appointments provider tags blocked time `metadata.type === 'blocked-time'`
 * (see `blockedTimeToEvent`); `'unavailability'` is the legacy tag. Surfaces MUST
 * use this helper rather than testing one tag by hand — a stale check routed
 * blocks into the APPOINTMENT editor, which then fired appointment endpoints
 * with a blocked-time id.
 */
export function isTimeBlockEvent(event: IEvent): boolean {
  const type = event.metadata?.type;
  return type === 'blocked-time' || type === 'unavailability';
}

/**
 * Whether an event belongs in a practitioner's day/week column.
 * Appointments: match metadata.practitionerId, or fall back to assignedToId
 * (event.user.id) when practitionerId is unset but the practitioner is linked
 * to that org member via userId.
 */
export function eventBelongsToPractitioner(
  event: IEvent,
  practitioner: PractitionerColumn
): boolean {
  // Blocked time can apply to multiple practitioners; an empty/absent
  // practitioner set means an org-wide block visible in every column.
  if (event.metadata?.type === 'blocked-time') {
    const ids = event.metadata.practitionerIds as string[] | undefined;
    return !ids || ids.length === 0 || ids.includes(practitioner.id);
  }

  if (event.metadata?.type === 'unavailability') {
    return (
      !event.metadata.practitionerId ||
      event.metadata.practitionerId === practitioner.id
    );
  }

  const eventPractitionerId = event.metadata?.practitionerId;
  if (
    typeof eventPractitionerId === 'string' &&
    eventPractitionerId.length > 0
  ) {
    return eventPractitionerId === practitioner.id;
  }

  return !!practitioner.userId && event.user.id === practitioner.userId;
}

export function groupEvents(dayEvents: IEvent[]) {
  const sortedEvents = dayEvents.sort(
    (a, b) => parseISO(a.startDate).getTime() - parseISO(b.startDate).getTime()
  );
  const groups: IEvent[][] = [];

  for (const event of sortedEvents) {
    const eventStart = parseISO(event.startDate);

    let placed = false;
    for (const group of groups) {
      const lastEventInGroup = group[group.length - 1];
      const lastEventEnd = parseISO(lastEventInGroup.endDate);

      if (eventStart >= lastEventEnd) {
        group.push(event);
        placed = true;
        break;
      }
    }

    if (!placed) groups.push([event]);
  }

  return groups;
}

export function getEventBlockStyle(
  event: IEvent,
  day: Date,
  groupIndex: number,
  groupSize: number,
  visibleHoursRange: { from: number; to: number } | undefined,
  timeZone: string
) {
  // Position by the event's wall-clock minutes-of-day in the BUSINESS timezone,
  // so blocks land where the viewer expects regardless of their device tz.
  const startInstant = parseISO(event.startDate);
  const columnDateStr = format(day, 'yyyy-MM-dd');
  const eventDateStr = zonedDateString(startInstant, timeZone);
  // Event started on an earlier day (spillover) → pin to the top of this column.
  const startMinutes =
    eventDateStr < columnDateStr
      ? 0
      : zonedMinutesOfDay(startInstant, timeZone);

  let top: number;

  if (visibleHoursRange) {
    const visibleStartMinutes = visibleHoursRange.from * 60;
    const visibleEndMinutes = visibleHoursRange.to * 60;
    const visibleRangeMinutes = visibleEndMinutes - visibleStartMinutes;
    top = ((startMinutes - visibleStartMinutes) / visibleRangeMinutes) * 100;
  } else {
    top = (startMinutes / 1440) * 100;
  }

  const width = 100 / groupSize;
  const left = groupIndex * width;

  return { top: `${top}%`, width: `${width}%`, left: `${left}%` };
}

export function isWorkingHour(
  day: Date,
  hour: number,
  workingHours: TWorkingHours
) {
  const dayIndex = day.getDay() as keyof typeof workingHours;
  const dayHours = workingHours[dayIndex];
  if (!dayHours || dayHours.from === dayHours.to) return false;
  return hour >= dayHours.from && hour < dayHours.to;
}

/**
 * Find a practitioner's resolved shift for a given day, or null when there is
 * no shift data (in which case callers fall back to location working hours).
 */
export function findResolvedShift(
  shifts: TResolvedShift[],
  practitionerId: string | null | undefined,
  day: Date
): TResolvedShift | null {
  if (!practitionerId || shifts.length === 0) return null;
  const dateStr = format(day, 'yyyy-MM-dd');
  return (
    shifts.find(
      (s) => s.practitionerId === practitionerId && s.date === dateStr
    ) ?? null
  );
}

/**
 * Whether a given hour cell should be shaded as off-shift for a column.
 *
 * When a resolved shift is supplied, time outside its intervals (or a day
 * marked off) is disabled. When there is NO shift for the day, behaviour
 * depends on whether the column belongs to a specific practitioner:
 *
 *  - `practitionerScoped` (a single-practitioner column): availability is
 *    shifts-only, so a day with no shift is fully off (the whole column
 *    hatches). Working hours never grant availability.
 *  - otherwise (the merged "all staff" column, which has no single-practitioner
 *    shift context): fall back to the standing working-hours shading so the
 *    combined overview still reads sensibly.
 *
 * The disabled cells render the 45° diagonal hatch.
 */
export function isHourDisabledForColumn(
  day: Date,
  hour: number,
  workingHours: TWorkingHours,
  shift: TResolvedShift | null | undefined,
  options?: { practitionerScoped?: boolean }
): boolean {
  if (shift) {
    if (shift.isOff || shift.intervals.length === 0) return true;
    const hourStart = hour * 60;
    const hourEnd = hourStart + 60;
    const covered = shift.intervals.some(
      (i) => i.startMinutes < hourEnd && i.endMinutes > hourStart
    );
    return !covered;
  }
  if (options?.practitionerScoped) return true;
  return !isWorkingHour(day, hour, workingHours);
}

/**
 * Anchor a (start, end) pair to its calendar date and clamp it into the
 * configured visible-hours window. Preserves duration where possible; if the
 * duration exceeds the visible window we anchor to the start and truncate the
 * end. `visibleHours.to === 24` means "midnight tomorrow".
 */
export function clampEventToVisibleHours(
  start: Date,
  end: Date,
  visibleHours: TVisibleHours
): { startDate: Date; endDate: Date } {
  const dayStart = new Date(start);
  dayStart.setHours(0, 0, 0, 0);

  const visibleStart = new Date(dayStart);
  visibleStart.setHours(visibleHours.from, 0, 0, 0);

  const visibleEnd = new Date(dayStart);
  if (visibleHours.to >= 24) {
    visibleEnd.setDate(visibleEnd.getDate() + 1);
    visibleEnd.setHours(0, 0, 0, 0);
  } else {
    visibleEnd.setHours(visibleHours.to, 0, 0, 0);
  }

  const durationMs = end.getTime() - start.getTime();
  let clampedStart = start;
  let clampedEnd = end;

  if (clampedStart.getTime() < visibleStart.getTime()) {
    clampedStart = visibleStart;
    clampedEnd = new Date(clampedStart.getTime() + durationMs);
  }

  if (clampedEnd.getTime() > visibleEnd.getTime()) {
    clampedEnd = visibleEnd;
    clampedStart = new Date(clampedEnd.getTime() - durationMs);
    if (clampedStart.getTime() < visibleStart.getTime()) {
      clampedStart = visibleStart;
    }
  }

  return { startDate: clampedStart, endDate: clampedEnd };
}

export function getVisibleHours(
  visibleHours: TVisibleHours,
  singleDayEvents: IEvent[],
  timeZone: string
) {
  let earliestEventHour = visibleHours.from;
  let latestEventHour = visibleHours.to;

  /**
   * The hour of the day's FIRST booking, independent of the configured window.
   *
   * `earliestEventHour` above is `min(window start, first event)`, so it cannot
   * answer "is there a booking above where we're about to scroll to?" — when the
   * window already starts at 00:00 it never moves. The views auto-scroll to
   * 09:00, which parked an 08:30 booking above the fold and, worse, bisected it:
   * the sticky header clipped it mid-text. They use this to avoid scrolling past
   * the first booking of the day. `undefined` when the day is empty.
   */
  let firstEventHour: number | undefined;

  for (const event of singleDayEvents) {
    const startTime = zonedEvent(event.startDate, timeZone);
    const startHour = startTime.getHours();
    const endTime = zonedEvent(event.endDate, timeZone);
    const endHour = endTime.getHours() + (endTime.getMinutes() > 0 ? 1 : 0);
    if (startHour < earliestEventHour) earliestEventHour = startHour;
    if (endHour > latestEventHour) latestEventHour = endHour;
    if (firstEventHour === undefined || startHour < firstEventHour) {
      firstEventHour = startHour;
    }
  }

  latestEventHour = Math.min(latestEventHour, 24);

  const hours = Array.from(
    { length: latestEventHour - earliestEventHour },
    (_, i) => i + earliestEventHour
  );

  return { hours, earliestEventHour, latestEventHour, firstEventHour };
}

// ================ Month view helper functions ================ //

export function getCalendarCells(selectedDate: Date): ICalendarCell[] {
  const currentYear = selectedDate.getFullYear();
  const currentMonth = selectedDate.getMonth();

  const getDaysInMonth = (year: number, month: number) =>
    new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) =>
    new Date(year, month, 1).getDay();

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDayOfMonth = getFirstDayOfMonth(currentYear, currentMonth);
  const daysInPrevMonth = getDaysInMonth(currentYear, currentMonth - 1);
  const totalDays = firstDayOfMonth + daysInMonth;

  const prevMonthCells = Array.from({ length: firstDayOfMonth }, (_, i) => ({
    day: daysInPrevMonth - firstDayOfMonth + i + 1,
    currentMonth: false,
    date: new Date(
      currentYear,
      currentMonth - 1,
      daysInPrevMonth - firstDayOfMonth + i + 1
    ),
  }));

  const currentMonthCells = Array.from({ length: daysInMonth }, (_, i) => ({
    day: i + 1,
    currentMonth: true,
    date: new Date(currentYear, currentMonth, i + 1),
  }));

  const nextMonthCells = Array.from(
    { length: (7 - (totalDays % 7)) % 7 },
    (_, i) => ({
      day: i + 1,
      currentMonth: false,
      date: new Date(currentYear, currentMonth + 1, i + 1),
    })
  );

  return [...prevMonthCells, ...currentMonthCells, ...nextMonthCells];
}

export function calculateMonthEventPositions(
  multiDayEvents: IEvent[],
  singleDayEvents: IEvent[],
  selectedDate: Date
) {
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);

  const eventPositions: { [key: string]: number } = {};
  const occupiedPositions: { [key: string]: boolean[] } = {};

  for (const day of eachDayOfInterval({ start: monthStart, end: monthEnd })) {
    occupiedPositions[day.toISOString()] = [false, false, false];
  }

  const sortedEvents = [
    ...multiDayEvents.sort((a, b) => {
      const aDuration = differenceInDays(
        parseISO(a.endDate),
        parseISO(a.startDate)
      );
      const bDuration = differenceInDays(
        parseISO(b.endDate),
        parseISO(b.startDate)
      );
      return (
        bDuration - aDuration ||
        parseISO(a.startDate).getTime() - parseISO(b.startDate).getTime()
      );
    }),
    ...singleDayEvents.sort(
      (a, b) =>
        parseISO(a.startDate).getTime() - parseISO(b.startDate).getTime()
    ),
  ];

  for (const event of sortedEvents) {
    const eventStart = parseISO(event.startDate);
    const eventEnd = parseISO(event.endDate);
    const eventDays = eachDayOfInterval({
      start: eventStart < monthStart ? monthStart : eventStart,
      end: eventEnd > monthEnd ? monthEnd : eventEnd,
    });

    let position = -1;

    for (let i = 0; i < 3; i++) {
      if (
        eventDays.every((day) => {
          const dayPositions = occupiedPositions[startOfDay(day).toISOString()];
          return dayPositions && !dayPositions[i];
        })
      ) {
        position = i;
        break;
      }
    }

    if (position !== -1) {
      for (const day of eventDays) {
        const dayKey = startOfDay(day).toISOString();
        occupiedPositions[dayKey][position] = true;
      }
      eventPositions[event.id] = position;
    }
  }

  return eventPositions;
}

/**
 * The events belonging in one month-grid cell.
 *
 * `date` names the cell's calendar day; membership is resolved in the BUSINESS
 * timezone so a cell holds the org's day, not the viewer's. Comparing an
 * instant against a browser-local `isSameDay` put an LA salon's late-afternoon
 * booking in the NEXT cell for a viewer east of it — the month-view twin of the
 * empty day view. See {@link getViewRange}.
 */
export function getMonthCellEvents(
  date: Date,
  events: IEvent[],
  eventPositions: Record<string, number>,
  timeZone: string
) {
  // The cell's own day, as a plain YYYY-MM-DD key. `date` is already a local
  // Date naming that day, so its local fields are the truth here — it is not an
  // instant to be converted.
  const cellDay = format(date, 'yyyy-MM-dd');

  const eventsForDate = events.filter((event) => {
    const startDay = zonedDateString(parseISO(event.startDate), timeZone);
    const endDay = zonedDateString(parseISO(event.endDate), timeZone);
    // Inclusive on both ends so a multi-day event fills every cell it spans.
    return startDay <= cellDay && cellDay <= endDay;
  });

  return eventsForDate
    .map((event) => ({
      ...event,
      position: eventPositions[event.id] ?? -1,
      isMultiDay: event.startDate !== event.endDate,
    }))
    .sort((a, b) => {
      if (a.isMultiDay && !b.isMultiDay) return -1;
      if (!a.isMultiDay && b.isMultiDay) return 1;
      return a.position - b.position;
    });
}
