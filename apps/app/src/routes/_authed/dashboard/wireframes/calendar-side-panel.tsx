import { createFileRoute } from '@tanstack/react-router';

import { WfCalendarSidePanel } from '@/features/wireframes/clinic/calendar-side-panel';

/**
 * Wireframe: Appointment side panel.
 *
 * Static review page — fixtures only, no queries, no writes. Not linked from
 * anywhere in the product; delete it once the surface ships for real.
 */
export const Route = createFileRoute(
  '/_authed/dashboard/wireframes/calendar-side-panel'
)({
  component: WfCalendarSidePanel,
});
