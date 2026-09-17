import { createFileRoute, redirect } from '@tanstack/react-router';

import { branchPath } from '@/features/organization-locations/branch-path';

/** Team defaults to members. */
export const Route = createFileRoute('/_authed/dashboard/l/$locationId/team/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: branchPath(params.locationId, '/team/members') });
  },
});
