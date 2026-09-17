import { createFileRoute } from '@tanstack/react-router';

import { redirectToBranch } from '@/features/organization-locations/redirect-to-branch';

/**
 * Segments no longer has its own surface — saved audiences live in the
 * campaign composer's "Send to" picker, and the filter builder opens there
 * as a drawer. Old links land on the campaigns index.
 */
export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/campaigns/segments/'
)({
  beforeLoad: ({ context }) =>
    redirectToBranch(context.queryClient, '/marketing/campaigns'),
});
