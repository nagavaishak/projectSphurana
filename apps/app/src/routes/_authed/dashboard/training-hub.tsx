import { createFileRoute } from '@tanstack/react-router';

import { redirectToBranch } from '@/features/organization-locations/redirect-to-branch';

/** Training hub was removed. Kept as a redirect so bookmarks do not 404. */
export const Route = createFileRoute('/_authed/dashboard/training-hub')({
  beforeLoad: ({ context }) => redirectToBranch(context.queryClient, '/home'),
});
