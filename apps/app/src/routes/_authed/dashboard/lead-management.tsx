import { createFileRoute } from '@tanstack/react-router';

import { redirectToBranch } from '@/features/organization-locations/redirect-to-branch';

/**
 * Redirect shim. `/dashboard/lead-management` was the old Leads surface, now
 * folded into the unified Clients page. See `clients/list.tsx` for why the old
 * paths keep answering.
 */
export const Route = createFileRoute('/_authed/dashboard/lead-management')({
  beforeLoad: ({ context }) =>
    redirectToBranch(context.queryClient, '/customers'),
});
