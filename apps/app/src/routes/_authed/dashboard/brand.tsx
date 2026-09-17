import { createFileRoute } from '@tanstack/react-router';

import { redirectToBranch } from '@/features/organization-locations/redirect-to-branch';

/** Brand styling moved into Settings. Kept as a redirect for old links. */
export const Route = createFileRoute('/_authed/dashboard/brand')({
  beforeLoad: ({ context }) =>
    redirectToBranch(context.queryClient, '/settings/style'),
});
