import { createFileRoute } from '@tanstack/react-router';

import { redirectToBranch } from '@/features/organization-locations/redirect-to-branch';

/**
 * The segment builder now opens as a drawer inside the campaign composer
 * ("More options" under Send to). Old links land on the composer.
 */
export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/campaigns/segments/new/'
)({
  beforeLoad: ({ context }) =>
    redirectToBranch(context.queryClient, '/marketing/campaigns/new'),
});
