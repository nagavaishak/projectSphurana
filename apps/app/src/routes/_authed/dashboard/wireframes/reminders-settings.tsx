import { createFileRoute } from '@tanstack/react-router';

import { WfRemindersSettings } from '@/features/wireframes/growth/reminders-settings';

/**
 * Wireframe: Reminders & rebooking.
 *
 * Static review page — fixtures only, no queries, no writes. Not linked from
 * anywhere in the product; delete it once the surface ships for real.
 */
export const Route = createFileRoute(
  '/_authed/dashboard/wireframes/reminders-settings'
)({
  component: WfRemindersSettings,
});
