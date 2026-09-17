import { createFileRoute } from '@tanstack/react-router';

import { redirectToBranch } from '@/features/organization-locations/redirect-to-branch';

/** Moved. Kept as a redirect for old links. */
export const Route = createFileRoute('/_authed/dashboard/content/library')({
  beforeLoad: ({ context }) =>
    redirectToBranch(context.queryClient, '/marketing/gallery/library'),
});
