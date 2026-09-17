import { createFileRoute } from '@tanstack/react-router';

import { WfNotificationPrefs } from '@/features/wireframes/growth/notifications-prefs';

/**
 * Wireframe: notification preference matrix and digests (§15.3, §15.4).
 *
 * Static review page — fixtures only, no queries, no writes. Not linked from
 * anywhere in the product; delete it once the surface ships for real.
 */
export const Route = createFileRoute(
  '/_authed/dashboard/wireframes/notifications'
)({
  component: WfNotificationPrefs,
});
