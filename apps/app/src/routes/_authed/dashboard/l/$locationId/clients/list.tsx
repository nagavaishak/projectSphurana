import { createFileRoute, redirect } from '@tanstack/react-router';

import { branchPath } from '@/features/organization-locations/branch-path';

/**
 * Redirect shim. `/dashboard/clients/list` was the old Leads table; the unified
 * Clients surface replaced it. Kept because the path is in bookmarks, in links
 * we have already sent out, and in the mobile nav history — a 404 there reads
 * as "the app lost my clients".
 */
export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/clients/list'
)({
  beforeLoad: ({ params }) => {
    throw redirect({ to: branchPath(params.locationId, '/customers') });
  },
});
