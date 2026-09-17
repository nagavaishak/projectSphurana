import { createFileRoute, redirect } from '@tanstack/react-router';

import { branchPath } from '@/features/organization-locations/branch-path';

/** /dashboard/clients now points at the unified Clients surface. */
export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/clients/'
)({
  beforeLoad: ({ params }) => {
    throw redirect({ to: branchPath(params.locationId, '/customers') });
  },
});
