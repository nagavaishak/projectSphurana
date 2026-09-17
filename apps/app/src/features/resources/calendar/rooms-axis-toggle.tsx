import { Link, useLocation } from '@tanstack/react-router';
import { DoorOpen, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useBranchRoutes } from '@/lib/use-routes';

/**
 * Views that exist on BOTH axes. `agenda` and `year` are staff-only (rooms are
 * a filter there, not an axis), so entering the rooms axis from one falls back
 * to the day view rather than 404-ing.
 */
const SHARED_VIEW_SLUGS = new Set(['day', 'three-day', 'week', 'month']);

function currentViewSlug(pathname: string): string {
  return pathname.split('/').filter(Boolean).pop() ?? 'day';
}

interface RoomsAxisToggleProps {
  /** Which axis is currently showing. */
  axis: 'team' | 'rooms';
}

/**
 * Staff ⇄ Rooms axis switch.
 *
 * PRESERVES THE VIEW MODE. Switching axes on the week view must leave you on
 * the week view — both trees use the same route slugs, so the current slug is
 * simply carried across. Anything else makes the toggle feel like it threw your
 * place away.
 */
export function RoomsAxisToggle({ axis }: RoomsAxisToggleProps) {
  const routes = useBranchRoutes();
  const pathname = useLocation({ select: (location) => location.pathname });
  const slug = currentViewSlug(pathname);
  const roomsSlug = SHARED_VIEW_SLUGS.has(slug) ? slug : 'day';

  return (
    <div className="inline-flex" role="group" aria-label="Calendar columns">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            asChild
            size="icon"
            variant={axis === 'team' ? 'default' : 'outline'}
            aria-label="Show team columns"
            aria-pressed={axis === 'team'}
            className="rounded-r-none"
          >
            <Link to={`${routes.calendar}/${slug}` as never}>
              <Users />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Team</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            asChild
            size="icon"
            variant={axis === 'rooms' ? 'default' : 'outline'}
            aria-label="Show room columns"
            aria-pressed={axis === 'rooms'}
            className="-ml-px rounded-l-none"
          >
            <Link to={`${routes.calendarRooms}/${roomsSlug}` as never}>
              <DoorOpen />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Rooms</TooltipContent>
      </Tooltip>
    </div>
  );
}
