import { createFileRoute, redirect } from '@tanstack/react-router';

import { branchPath } from '@/features/organization-locations/branch-path';

/** Moved. Kept as a redirect for old links. */
export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/team/practitioners'
)({
  beforeLoad: ({ params }) => {
    throw redirect({ to: branchPath(params.locationId, '/team/members') });
  },
});
