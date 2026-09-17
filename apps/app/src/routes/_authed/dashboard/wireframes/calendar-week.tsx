import { createFileRoute } from '@tanstack/react-router';

import { WfCalendarWeek } from '@/features/wireframes/clinic/calendar-week';

/**
 * Wireframe: Week capacity grid.
 *
 * Static review page — fixtures only, no queries, no writes. Not linked from
 * anywhere in the product; delete it once the surface ships for real.
 */
export const Route = createFileRoute(
  '/_authed/dashboard/wireframes/calendar-week'
)({
  component: WfCalendarWeek,
});
