import {
  addDays,
  endOfMonth,
  endOfWeek,
  endOfYear,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns';
import { useState } from 'react';

import { useCalendar } from '@/components/calendar/contexts/calendar-context';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

import type { TCalendarView } from '@/components/calendar/types';
import type { DateRange } from 'react-day-picker';

interface IProps {
  view: TCalendarView;
  /** Text shown inside the trigger box (e.g. "Mon, Jul 7"). */
  label: string;
}

/** The date span covered by a given view, used to highlight the range picker. */
function getViewRange(view: TCalendarView, date: Date): DateRange {
  switch (view) {
    case '3day':
      return { from: date, to: addDays(date, 2) };
    case 'week':
      return { from: startOfWeek(date), to: endOfWeek(date) };
    case 'agenda':
    case 'month':
      return { from: startOfMonth(date), to: endOfMonth(date) };
    case 'year':
      return { from: startOfYear(date), to: endOfYear(date) };
    default:
      return { from: date, to: date };
  }
}

/**
 * The header date box. Clicking it drops down a calendar picker. In day view
 * it's a single-date picker; in multi-day views (3-day, week, month, …) it
 * shows a two-month range calendar highlighting the current view's span, and
 * picking any day re-anchors the view onto that day.
 */
export function DatePickerPopover({ view, label }: IProps) {
  const { selectedDate, setSelectedDate } = useCalendar();
  const [open, setOpen] = useState(false);

  const select = (date: Date | undefined) => {
    if (!date) return;
    setSelectedDate(date);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="min-w-[132px] rounded-md border px-3 py-1.5 text-center text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {label}
        </button>
      </PopoverTrigger>

      <PopoverContent align="center" className="w-auto p-0">
        {view === 'day' ? (
          <Calendar
            mode="single"
            defaultMonth={selectedDate}
            selected={selectedDate}
            onSelect={select}
            autoFocus
          />
        ) : (
          <Calendar
            mode="range"
            defaultMonth={selectedDate}
            selected={getViewRange(view, selectedDate)}
            numberOfMonths={2}
            onSelect={(_range, triggerDate) => select(triggerDate)}
            autoFocus
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
