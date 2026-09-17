import { createFileRoute } from '@tanstack/react-router';

import { redirectToBranch } from '@/features/organization-locations/redirect-to-branch';

/** Marketing defaults to the socials planner. */
export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/'
)({
  beforeLoad: ({ context }) =>
    redirectToBranch(context.queryClient, '/marketing/socials'),
});
