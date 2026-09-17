import { format, parseISO } from 'date-fns';
import { CalendarX2 } from 'lucide-react';
import { useMemo } from 'react';

import { useCalendar } from '@/components/calendar/contexts/calendar-context';
import { zonedDateString } from '@/lib/timezone';

import { AgendaDayGroup } from '@/components/calendar/components/agenda-view/agenda-day-group';
import { ScrollArea } from '@/components/ui/scroll-area';

import type { IEvent } from '@/components/calendar/interfaces';

interface IProps {
  singleDayEvents: IEvent[];
  multiDayEvents: IEvent[];
}

export function CalendarAgendaView({
  singleDayEvents,
  multiDayEvents,
}: IProps) {
  const { selectedDate, timeZone } = useCalendar();

  const eventsByDay = useMemo(() => {
    const allDates = new Map<
      string,
      { date: Date; events: IEvent[]; multiDayEvents: IEvent[] }
    >();

    // Group by the BUSINESS day, not the viewer's: an instant late in the org's
    // day is already tomorrow for a viewer east of it, which used to file the
    // booking under the wrong heading (and, at a month boundary, drop it from
    // the agenda entirely).
    const selectedMonth = format(selectedDate, 'yyyy-MM');
    // A day key back to a local Date naming that day — the convention every
    // downstream `format(date, ...)` here expects.
    const dayKeyToDate = (key: string) => {
      const [y, m, d] = key.split('-').map(Number);
      return new Date(y, m - 1, d);
    };

    for (const event of singleDayEvents) {
      const dateKey = zonedDateString(parseISO(event.startDate), timeZone);
      if (!dateKey.startsWith(selectedMonth)) continue;

      if (!allDates.has(dateKey)) {
        allDates.set(dateKey, {
          date: dayKeyToDate(dateKey),
          events: [],
          multiDayEvents: [],
        });
      }

      allDates.get(dateKey)?.events.push(event);
    }

    for (const event of multiDayEvents) {
      const lastKey = zonedDateString(parseISO(event.endDate), timeZone);
      // Walk the org's calendar days from start to end inclusive. Stepping a
      // local Date by one day and re-keying keeps month/year rollover correct.
      let cursor = dayKeyToDate(
        zonedDateString(parseISO(event.startDate), timeZone)
      );

      for (let guard = 0; guard < 366; guard++) {
        const dateKey = format(cursor, 'yyyy-MM-dd');
        if (dateKey > lastKey) break;

        if (dateKey.startsWith(selectedMonth)) {
          if (!allDates.has(dateKey)) {
            allDates.set(dateKey, {
              date: dayKeyToDate(dateKey),
              events: [],
              multiDayEvents: [],
            });
          }

          allDates.get(dateKey)?.multiDayEvents.push(event);
        }
        cursor = new Date(
          cursor.getFullYear(),
          cursor.getMonth(),
          cursor.getDate() + 1
        );
      }
    }

    return Array.from(allDates.values()).sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    );
  }, [singleDayEvents, multiDayEvents, selectedDate, timeZone]);

  const hasAnyEvents = singleDayEvents.length > 0 || multiDayEvents.length > 0;

  return (
    <div className="h-[800px]">
      <ScrollArea className="h-full" type="always">
        <div className="space-y-6 p-4">
          {eventsByDay.map((dayGroup) => (
            <AgendaDayGroup
              key={format(dayGroup.date, 'yyyy-MM-dd')}
              date={dayGroup.date}
              events={dayGroup.events}
              multiDayEvents={dayGroup.multiDayEvents}
            />
          ))}

          {!hasAnyEvents && (
            <div className="flex flex-col items-center justify-center gap-2 py-20 text-muted-foreground">
              <CalendarX2 className="size-10" />
              <p className="text-sm md:text-base">
                No events scheduled for the selected month
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
