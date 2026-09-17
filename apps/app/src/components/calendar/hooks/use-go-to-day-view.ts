import { useNavigate } from '@tanstack/react-router';

import { useCalendar } from '@/components/calendar/contexts/calendar-context';

/**
 * Returns a handler that jumps to the single-day view for a given date.
 *
 * The person selection (`selectedUserIds`), location and other filters live in
 * the calendar context, which persists across the day/3-day/week route change,
 * so the day view opens with the same settings — one person stays one person,
 * "all"/multi stays multi.
 */
export function useGoToDayView() {
  const navigate = useNavigate();
  const { setSelectedDate, config } = useCalendar();
  const basePath = config.routerBasePath ?? '/dashboard/calendar';

  return (day: Date) => {
    setSelectedDate(day);
    navigate({ to: `${basePath}/day` as never });
  };
}
