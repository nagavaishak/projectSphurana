import { createFileRoute, redirect } from '@tanstack/react-router';

import { branchRoutes } from '@/lib/route-paths';

/**
 * Default appointments view. Bookings defaults to the day view (Fresha-style
 * team columns — one column per staff member).
 *
 * Reads the branch from `params` rather than resolving one: this route only
 * matches UNDER the branch layout, so the id is present and already validated
 * there. Falling back to the entry-branch resolver here would let a mismatch
 * between the URL and the resolved branch go unnoticed.
 */
export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/calendar/'
)({
  beforeLoad: ({ params }) => {
    throw redirect({ to: branchRoutes(params.locationId).calendarDay });
  },
});
