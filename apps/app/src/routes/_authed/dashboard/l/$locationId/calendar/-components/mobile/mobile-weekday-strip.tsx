import { addWeeks, format, isSameDay, startOfWeek, subWeeks } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useCalendar } from '@/components/calendar';
import { cn } from '@/lib/utils';

interface MobileWeekdayStripProps {
  /**
   * Optional slot rendered to the right of the month label row — used by the
   * bookings header to drop in the Filters icon button.
   */
  rightActions?: React.ReactNode;
}

/**
 * Horizontal weekday strip — month label + week-paging arrows on top, then
 * the seven days of the visible week below. Supports swipe/scroll between
 * weeks via a 3-page snap container (prev / current / next): when the user
 * lands on prev or next, we shift selectedDate by ±7 days and recenter
 * silently to give the illusion of an infinite strip.
 */
export function MobileWeekdayStrip({
  rightActions,
}: MobileWeekdayStripProps = {}) {
  const { selectedDate, setSelectedDate } = useCalendar();

  return (
    <div className="flex flex-col gap-2 pt-3 pb-2">
      <div className="relative flex items-center justify-center gap-3 px-4">
        <button
          type="button"
          onClick={() => setSelectedDate(subWeeks(selectedDate, 1))}
          aria-label="Previous week"
          className="flex size-7 items-center justify-center rounded-full text-muted-foreground active:bg-accent"
        >
          <ChevronLeft className="size-4" strokeWidth={2} />
        </button>
        <span className="text-sm font-medium">
          {format(selectedDate, 'MMMM yyyy')}
        </span>
        <button
          type="button"
          onClick={() => setSelectedDate(addWeeks(selectedDate, 1))}
          aria-label="Next week"
          className="flex size-7 items-center justify-center rounded-full text-muted-foreground active:bg-accent"
        >
          <ChevronRight className="size-4" strokeWidth={2} />
        </button>
        {rightActions && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {rightActions}
          </div>
        )}
      </div>

      <SwipeableWeeks
        anchor={selectedDate}
        onSwipe={(direction) => {
          setSelectedDate(
            direction === 'next'
              ? addWeeks(selectedDate, 1)
              : subWeeks(selectedDate, 1)
          );
        }}
        renderDay={(d) => <DayCell date={d} />}
      />
    </div>
  );
}

interface SwipeableWeeksProps {
  anchor: Date;
  onSwipe: (direction: 'prev' | 'next') => void;
  renderDay: (date: Date) => React.ReactNode;
}

/**
 * Three-page horizontal snap-scroller. Page 1 always starts centered on
 * `anchor`'s week. When the user lands on page 0 or 2 we fire onSwipe and
 * silently re-center to page 1 on the next anchor change.
 */
function SwipeableWeeks({ anchor, onSwipe, renderDay }: SwipeableWeeksProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // Suppresses the onScroll handler while we programmatically recenter after
  // a swipe — otherwise the recentering scroll fires onScroll again and we'd
  // double-page.
  const suppressScroll = useRef(false);

  // Build the three weeks around the anchor.
  const weeks = [-1, 0, 1].map((offset) => {
    const wkStart = startOfWeek(addWeeks(anchor, offset), { weekStartsOn: 1 });
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(wkStart);
      d.setDate(wkStart.getDate() + i);
      return d;
    });
  });

  // Measure the container width — each page = one container-width.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Whenever the anchor changes (because user paged, swiped, or tapped a
  // chevron), snap back to the middle page without animation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: anchor is the trigger; the effect intentionally re-centers on every anchor change without reading it.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || width === 0) return;
    suppressScroll.current = true;
    el.scrollTo({ left: width, behavior: 'auto' });
    // Allow scroll events again on the next tick.
    requestAnimationFrame(() => {
      suppressScroll.current = false;
    });
  }, [anchor, width]);

  const handleScroll = () => {
    if (suppressScroll.current) return;
    const el = scrollerRef.current;
    if (!el || width === 0) return;
    // Snap fires after the scroll settles — detect which page we landed on.
    const page = Math.round(el.scrollLeft / width);
    if (page === 0) onSwipe('prev');
    else if (page === 2) onSwipe('next');
  };

  return (
    <div
      ref={scrollerRef}
      onScroll={handleScroll}
      className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {weeks.map((week, i) => (
        <div
          key={i}
          className="flex shrink-0 snap-start items-stretch justify-between gap-1 px-2"
          style={{ width: width || '100%' }}
        >
          {week.map((d) => (
            <div key={d.toISOString()} className="flex-1">
              {renderDay(d)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function DayCell({ date }: { date: Date }) {
  const { selectedDate, setSelectedDate } = useCalendar();
  const isSelected = isSameDay(date, selectedDate);
  const isToday = isSameDay(date, new Date());
  return (
    <button
      type="button"
      onClick={() => setSelectedDate(date)}
      className={cn(
        'flex w-full flex-col items-center gap-0.5 rounded-lg py-1.5',
        isSelected
          ? 'bg-foreground text-background'
          : 'text-foreground active:bg-accent'
      )}
    >
      <span
        className={cn(
          'text-[10px] font-medium uppercase',
          isSelected ? 'text-background/80' : 'text-muted-foreground'
        )}
      >
        {format(date, 'EEE')}
      </span>
      <span
        className={cn(
          'text-sm font-semibold',
          isToday && !isSelected && 'text-primary'
        )}
      >
        {format(date, 'd')}
      </span>
      <span
        className={cn(
          'h-1 w-1 rounded-full',
          isToday
            ? isSelected
              ? 'bg-background'
              : 'bg-primary'
            : 'bg-transparent'
        )}
        aria-hidden
      />
    </button>
  );
}
