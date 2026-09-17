import { Outlet, createFileRoute } from '@tanstack/react-router';

import { RoomsCalendarProvider } from '@/features/resources/calendar';

import { MobileRoomsHeader } from './-components/mobile/mobile-rooms-header';

/**
 * Rooms axis layout.
 *
 * Mirrors the bookings calendar exactly — one layout route holding the
 * provider, one nested file route per view — so the shared view switcher,
 * the day-header "jump to this day" links and the month-cell click all
 * navigate normally under `config.routerBasePath`.
 *
 * Sits under `/dashboard/calendar`, so the parent layout's
 * "is Borradh the primary calendar?" guard already applies. The inner
 * `CalendarProvider` this mounts shadows the bookings one for its subtree,
 * which is what puts rooms on the columns.
 */
export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/calendar/rooms'
)({
  component: RoomsCalendarLayout,
});

function RoomsCalendarLayout() {
  return (
    <RoomsCalendarProvider
      mobileHeader={({ view, basePath }) => (
        <MobileRoomsHeader view={view} basePath={basePath} />
      )}
    >
      <div className="flex h-full flex-col">
        <Outlet />
      </div>
    </RoomsCalendarProvider>
  );
}
