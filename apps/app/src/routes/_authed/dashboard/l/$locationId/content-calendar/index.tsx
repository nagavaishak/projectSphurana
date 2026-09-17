import { createFileRoute } from '@tanstack/react-router';

import { redirectToBranch } from '@/features/organization-locations/redirect-to-branch';

/** Content planner defaults to the week view. */
export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/content-calendar/'
)({
  beforeLoad: ({ context }) =>
    redirectToBranch(context.queryClient, '/content-calendar/week'),
});
