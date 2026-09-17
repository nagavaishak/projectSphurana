import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * Moved to `/review-content`, which sits outside the dashboard layout so the
 * review workspace gets the full viewport. Kept as a redirect for old links —
 * including `/dashboard/socials/review`, which already redirects here.
 */
export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/socials/review'
)({
  beforeLoad: () => {
    throw redirect({ to: '/review-content' });
  },
});
