import { createFileRoute, redirect } from '@tanstack/react-router';

import { branchPath } from '@/features/organization-locations/branch-path';

/** Catalog defaults to services. */
export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/catalog/'
)({
  beforeLoad: ({ params }) => {
    throw redirect({ to: branchPath(params.locationId, '/catalog/services') });
  },
});
