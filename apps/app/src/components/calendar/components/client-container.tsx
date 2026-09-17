import { parseISO } from 'date-fns';
import { useMemo } from 'react';

import { useCalendar } from '@/components/calendar/contexts/calendar-context';
import { getViewRange } from '@/components/calendar/helpers';
import type { IEvent } from '@/components/calendar/interfaces';
import { useMobileDashboardHeaderContent } from '@/features/mobile-dashboard-header';
import { useIsMobile } from '@/hooks/use-mobile';
import { zonedDateString } from '@/lib/timezone';

import { DndProviderWrapper } from '@/components/calendar/components/dnd/dnd-provider';

import { CalendarAgendaView } from '@/components/calendar/components/agenda-view/calendar-agenda-view';
import { CalendarHeader } from '@/components/calendar/components/header/calendar-header';
import { CalendarMonthView } from '@/components/calendar/components/month-view/calendar-month-view';
import { CalendarDayView } from '@/components/calendar/components/week-and-day-view/calendar-day-view';
import { CalendarDayViewPerStaff } from '@/components/calendar/components/week-and-day-view/calendar-day-view-per-staff';
import { CalendarResourceDaysView } from '@/components/calendar/components/week-and-day-view/calendar-resource-days-view';
import { CalendarWeekView } from '@/components/calendar/components/week-and-day-view/calendar-week-view';
import { CalendarYearView } from '@/components/calendar/components/year-view/calendar-year-view';

import type { TCalendarView } from '@/components/calendar/types';

interface IProps {
  view: TCalendarView;
  basePath?: string;
  /** Hide the day/week/month/agenda view switcher (e.g. a month-only embed). */
  hideViewSwitcher?: boolean;
}

/**
 * Fallback mobile header content for calendars that don't supply their own
 * `config.mobileHeader`. Kept as a child component so exactly one consumer
 * writes to the shared header content — two would clobber each other.
 */
function MobileHeadingRegistrar({ heading }: { heading: string }) {
  useMobileDashboardHeaderContent(useMemo(() => ({ heading }), [heading]));
  return null;
}

export function ClientContainer({
  view,
  basePath = '',
  hideViewSwitcher = false,
}: IProps) {
  const isMobile = useIsMobile();
  const {
    selectedDate,
    selectedUserIds,
    selectedServiceId,
    events,
    config,
    timeZone,
  } = useCalendar();

  const filteredEvents = useMemo(() => {
    const matchesUser = (event: IEvent) => {
      if (selectedUserIds === 'all') return true;
      if (selectedUserIds.length === 0) return false;
      if (config.eventFilter) {
        return selectedUserIds.some((id) => config.eventFilter?.(event, id));
      }
      return selectedUserIds.includes(event.user.id);
    };
    const matchesService = (event: IEvent) => {
      if (selectedServiceId === 'all') return true;
      // Unavailability events have no service — they always pass so a staff's
      // breaks/holidays stay visible even when a single service is filtered.
      if (event.metadata?.type === 'unavailability') return true;
      return event.metadata?.serviceId === selectedServiceId;
    };

    // Window resolved in the BUSINESS timezone. Shared with the header's
    // event count so the badge can never disagree with the grid.
    const { start, end } = getViewRange(selectedDate, view, timeZone);

    return events.filter((event) => {
      const eventStartDate = parseISO(event.startDate);
      const eventEndDate = parseISO(event.endDate);
      // Half-open: an event ending exactly at the boundary belongs to the
      // window it started in, not the next one.
      const overlapsView = eventStartDate < end && eventEndDate >= start;
      return overlapsView && matchesUser(event) && matchesService(event);
    });
  }, [
    selectedDate,
    selectedUserIds,
    selectedServiceId,
    events,
    view,
    config,
    timeZone,
  ]);

  // "Spans more than one day" is a question about the BUSINESS calendar, not
  // the viewer's: an LA 11:30pm-12:30am booking crosses midnight there while
  // sitting mid-morning in Dublin, and only the org's answer routes it to the
  // multi-day row correctly.
  const spansMultipleDays = (event: IEvent) =>
    zonedDateString(parseISO(event.startDate), timeZone) !==
    zonedDateString(parseISO(event.endDate), timeZone);

  const singleDayEvents = filteredEvents.filter(
    (event) => !spansMultipleDays(event)
  );

  const multiDayEvents = filteredEvents.filter(spansMultipleDays);

  // For year view, we only care about the start date
  // by using the same date for both start and end,
  // we ensure only the start day will show a dot
  const eventStartDates = useMemo(() => {
    return filteredEvents.map((event) => ({
      ...event,
      endDate: event.startDate,
    }));
  }, [filteredEvents]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {!isMobile ? (
        <CalendarHeader
          view={view}
          events={filteredEvents}
          basePath={basePath}
          hideViewSwitcher={hideViewSwitcher}
        />
      ) : config.mobileHeader ? (
        config.mobileHeader({ view, basePath })
      ) : view === 'day' || view === 'month' ? (
        <MobileHeadingRegistrar heading="Bookings" />
      ) : null}

      <DndProviderWrapper>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {view === 'day' &&
            (config.dayColumnsPerStaff ? (
              <CalendarDayViewPerStaff
                singleDayEvents={singleDayEvents}
                multiDayEvents={multiDayEvents}
              />
            ) : (
              <CalendarDayView
                singleDayEvents={singleDayEvents}
                multiDayEvents={multiDayEvents}
              />
            ))}
          {view === 'month' && (
            <CalendarMonthView
              singleDayEvents={singleDayEvents}
              multiDayEvents={multiDayEvents}
            />
          )}
          {view === '3day' && (
            <CalendarResourceDaysView
              singleDayEvents={singleDayEvents}
              multiDayEvents={multiDayEvents}
              dayCount={3}
            />
          )}
          {view === 'week' &&
            (config.dayColumnsPerStaff ? (
              <CalendarResourceDaysView
                singleDayEvents={singleDayEvents}
                multiDayEvents={multiDayEvents}
                dayCount={7}
              />
            ) : (
              <CalendarWeekView
                singleDayEvents={singleDayEvents}
                multiDayEvents={multiDayEvents}
              />
            ))}
          {view === 'year' && <CalendarYearView allEvents={eventStartDates} />}
          {view === 'agenda' && (
            <CalendarAgendaView
              singleDayEvents={singleDayEvents}
              multiDayEvents={multiDayEvents}
            />
          )}
        </div>
      </DndProviderWrapper>
    </div>
  );
}
