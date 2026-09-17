import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { RefreshCw } from 'lucide-react';

import { VIEW_ROUTE_SLUGS } from '@/components/calendar/components/header/view-routes';
import { useCalendar } from '@/components/calendar/contexts/calendar-context';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Refetches the calendar's active queries (appointments, blocked time,
 * shifts, schedules) and resets the calendar to the whole-team single day
 * view. Spins while any query is in flight.
 */
export function RefreshButton() {
  const queryClient = useQueryClient();
  const isFetching = useIsFetching();
  const { config, setSelectedUserIds } = useCalendar();
  const navigate = useNavigate();
  const basePath = config.routerBasePath ?? '';

  const handleClick = () => {
    queryClient.invalidateQueries({ type: 'active' });
    setSelectedUserIds('all');
    navigate({ to: `${basePath}/${VIEW_ROUTE_SLUGS.day}` as never });
  };

  return (
    <Button
      variant="outline"
      size="icon"
      aria-label="Refresh calendar"
      onClick={handleClick}
    >
      <RefreshCw className={cn('size-4', isFetching > 0 && 'animate-spin')} />
    </Button>
  );
}
