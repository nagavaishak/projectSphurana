import { createFileRoute, redirect } from '@tanstack/react-router';

import { branchRoutes } from '@/lib/route-paths';

/**
 * Rooms default to the day view — one column per room, like the bookings day
 * view.
 *
 * Reads the branch from `params` rather than resolving one, matching the
 * bookings `calendar/index.tsx` next door: this route only matches UNDER the
 * branch layout, so the id is present and already validated there.
 */
export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/calendar/rooms/'
)({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: branchRoutes(params.locationId).calendarRoomsDay,
    });
  },
});
