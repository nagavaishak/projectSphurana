import { createFileRoute, redirect } from '@tanstack/react-router';

import { branchPath } from '@/features/organization-locations/branch-path';

/** Moved to Inventory. Kept as a redirect for old links. */
export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/catalog/stock-orders'
)({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: branchPath(params.locationId, '/inventory/stock-orders'),
    });
  },
});
