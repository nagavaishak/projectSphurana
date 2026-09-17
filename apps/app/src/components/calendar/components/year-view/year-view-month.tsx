import { useNavigate } from '@tanstack/react-router';
import { format, getDaysInMonth, parseISO, startOfMonth } from 'date-fns';
import { useMemo } from 'react';

import { useCalendar } from '@/components/calendar/contexts/calendar-context';
import { zonedDateString } from '@/lib/timezone';

import { YearViewDayCell } from '@/components/calendar/components/year-view/year-view-day-cell';

import type { IEvent } from '@/components/calendar/interfaces';

interface IProps {
  month: Date;
  events: IEvent[];
}

export function YearViewMonth({ month, events }: IProps) {
  const navigate = useNavigate();
  const { setSelectedDate, config, timeZone } = useCalendar();
  const routerBase = config.routerBasePath ?? '/dashboard/content-calendar';

  const monthName = format(month, 'MMMM');

  const daysInMonth = useMemo(() => {
    const totalDays = getDaysInMonth(month);
    const firstDay = startOfMonth(month).getDay();

    const days = Array.from({ length: totalDays }, (_, i) => i + 1);
    const blanks = Array(firstDay).fill(null);

    return [...blanks, ...days];
  }, [month]);

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const handleClick = () => {
    setSelectedDate(new Date(month.getFullYear(), month.getMonth(), 1));
    navigate({ to: `${routerBase}/month` as never });
  };

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={handleClick}
        className="w-full rounded-t-lg border px-3 py-2 text-sm font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {monthName}
      </button>

      <div className="flex-1 space-y-2 rounded-b-lg border border-t-0 p-3">
        <div className="grid grid-cols-7 gap-x-0.5 text-center">
          {weekDays.map((day) => (
            <div
              key={day}
              className="text-xs font-medium text-muted-foreground"
            >
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-x-0.5 gap-y-2">
          {daysInMonth.map((day, gridPosition) => {
            if (day === null)
              return <div key={`blank-pos-${gridPosition}`} className="h-10" />;

            const date = new Date(month.getFullYear(), month.getMonth(), day);
            // Dot membership follows the BUSINESS day; comparing instants with
            // a browser-local isSameDay marked the wrong square for a viewer in
            // a different zone from the org.
            const dayKey = format(date, 'yyyy-MM-dd');
            const dayEvents = events.filter(
              (event) =>
                zonedDateString(parseISO(event.startDate), timeZone) ===
                  dayKey ||
                zonedDateString(parseISO(event.endDate), timeZone) === dayKey
            );

            return (
              <YearViewDayCell
                key={`day-${day}`}
                day={day}
                date={date}
                events={dayEvents}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
