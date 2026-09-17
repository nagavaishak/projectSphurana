import {
  RoomsAxisToggle,
  RoomsCategorySwitcher,
} from '@/features/resources/calendar';

import { MobileBookingsHeader } from './mobile-bookings-header';

import type { TCalendarView } from '@/components/calendar/types';

interface MobileRoomsHeaderProps {
  view: TCalendarView;
  basePath: string;
}

/**
 * Mobile header for the ROOMS axis.
 *
 * The rooms calendar declared no `mobileHeader`, so below `lg` it fell through
 * to the bare "Bookings" heading: no date navigation, no way back to the team
 * axis, and no category switcher. A phone user who reached
 * `/dashboard/calendar/rooms/day` could only leave via the bottom nav, and
 * could not change the day at all.
 *
 * Reuses the bookings header verbatim (date picker + view options, which are
 * axis-agnostic) and adds the two controls that only exist on this axis.
 *
 * Lives under `routes/` rather than in `features/resources` on purpose: the
 * bookings header is route-level, and `features → routes` is the import
 * direction that produced the circular import in §7 of the handoff.
 */
export function MobileRoomsHeader({ view, basePath }: MobileRoomsHeaderProps) {
  return (
    <>
      <MobileBookingsHeader view={view} basePath={basePath} />
      <div className="flex items-center gap-2 overflow-x-auto border-b bg-background px-3 py-2">
        <RoomsAxisToggle axis="rooms" />
        <RoomsCategorySwitcher />
      </div>
    </>
  );
}
