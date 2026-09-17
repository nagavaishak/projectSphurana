import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';
import { useEffect, useState } from 'react';

import { useCalendar } from '@/components/calendar/contexts/calendar-context';

interface IProps {
  firstVisibleHour: number;
  lastVisibleHour: number;
  /**
   * - `default` / `mobile`: red line with a dot + inline time label.
   * - `column`: line only (no dot/label) — rendered inside each staff column
   *   so the columns together read as one continuous line.
   * - `rail`: time pill only (no line) — rendered in the left hours rail.
   */
  variant?: 'default' | 'mobile' | 'column' | 'rail';
}

export function CalendarTimeline({
  firstVisibleHour,
  lastVisibleHour,
  variant = 'default',
}: IProps) {
  const { timeZone } = useCalendar();
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // "Now" positioned/labelled in the business timezone.
  const zonedNow = new TZDate(currentTime.getTime(), timeZone);

  const getCurrentTimePosition = () => {
    const minutes = zonedNow.getHours() * 60 + zonedNow.getMinutes();

    const visibleStartMinutes = firstVisibleHour * 60;
    const visibleEndMinutes = lastVisibleHour * 60;
    const visibleRangeMinutes = visibleEndMinutes - visibleStartMinutes;

    return ((minutes - visibleStartMinutes) / visibleRangeMinutes) * 100;
  };

  const formatCurrentTime = () => {
    return format(zonedNow, 'h:mm a');
  };

  const currentHour = zonedNow.getHours();
  if (currentHour < firstVisibleHour || currentHour >= lastVisibleHour)
    return null;

  // Line spanning a single staff column — no dot, no label. Stacked across
  // columns they form one continuous indicator (Fresha-style day view).
  if (variant === 'column') {
    return (
      <div
        className="pointer-events-none absolute inset-x-0 z-40 border-t-[1.5px] border-[#FF3B30]"
        style={{ top: `${getCurrentTimePosition()}%` }}
      />
    );
  }

  // Time pill rendered in the left hours rail, aligned to the line.
  if (variant === 'rail') {
    return (
      <div
        className="pointer-events-none absolute right-1 z-40 -translate-y-1/2"
        style={{ top: `${getCurrentTimePosition()}%` }}
      >
        {/*
          Text is #D62F26, not the #FF3B30 of the LINE itself. At 10px this is
          not "large text" under WCAG, so it needs 4.5:1 — #FF3B30 on white
          measures 3.54 and axe flags it `serious`. #D62F26 is the same hue,
          reads as the same red next to the line, and clears at 4.89.
        */}
        <span className="whitespace-nowrap rounded-full border border-[#FF3B30] bg-background px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[#D62F26]">
          {format(zonedNow, 'HH:mm')}
        </span>
      </div>
    );
  }

  const isMobile = variant === 'mobile';

  return (
    <div
      className={
        isMobile
          ? 'pointer-events-none absolute inset-x-0 z-50 border-t-2 border-[#FF3B30]'
          : 'pointer-events-none absolute inset-x-0 z-50 border-t border-primary'
      }
      style={{ top: `${getCurrentTimePosition()}%` }}
    >
      <div
        className={
          isMobile
            ? 'absolute left-0 top-0 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#FF3B30]'
            : 'absolute left-0 top-0 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary'
        }
      />
      {!isMobile ? (
        <div className="absolute -left-18 flex w-16 -translate-y-1/2 justify-end bg-background pr-1 text-xs font-medium text-primary">
          {formatCurrentTime()}
        </div>
      ) : null}
    </div>
  );
}
