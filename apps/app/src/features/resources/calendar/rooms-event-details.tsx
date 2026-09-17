import { DefaultEventDetailsDialog } from '@/components/calendar/components/dialogs/event-details-dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import type { IEvent } from '@/components/calendar';

import { roomsMetadata, turnaroundPercent } from './rooms-calendar-model';

interface RoomsEventDetailsProps {
  event: IEvent;
  children: React.ReactNode;
}

/**
 * The rooms calendar's `config.customEventDetailsDialog`.
 *
 * An allocation's `endDate` already includes `turnaroundMinutes`, so the block
 * the grid draws is correctly as tall as the room is actually occupied — but
 * without a marker the cleanup tail reads as bookable time and staff will try
 * to book into it. This layers a hatched tail over the bottom of the block.
 *
 * WHY HERE. `event-block.tsx` is a shared library component and stays
 * read-only. It renders its body inside `EventDetailsDialog`, which delegates
 * to `config.customEventDetailsDialog` and hands it the block as `children` —
 * so a host can wrap the block without the library knowing. That is the
 * documented overlay escape hatch, and it costs nothing: we re-render the
 * default dialog underneath so click-through behaviour is unchanged.
 */
export function RoomsEventDetails({ event, children }: RoomsEventDetailsProps) {
  const turnaroundMinutes = roomsMetadata(event)?.turnaroundMinutes ?? 0;
  const percent = turnaroundPercent(event);

  return (
    <DefaultEventDetailsDialog event={event}>
      <div className="relative">
        {children}
        {percent > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                data-turnaround-tail
                data-turnaround-minutes={turnaroundMinutes}
                aria-label={`Turnaround — ${turnaroundMinutes} min`}
                // `currentColor` drives the stripe utility, so the hatch picks
                // up the block's own colour instead of inventing a second one.
                className="absolute inset-x-0 bottom-0 rounded-b-md border-t border-dashed border-current/50 bg-unavailability-stripes opacity-90"
                style={{ height: `${percent}%` }}
              />
            </TooltipTrigger>
            <TooltipContent>
              Turnaround — {turnaroundMinutes} min
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </DefaultEventDetailsDialog>
  );
}
