import { createFileRoute } from '@tanstack/react-router';

import { redirectToBranch } from '@/features/organization-locations/redirect-to-branch';

export const Route = createFileRoute('/_authed/dashboard/content/')({
  beforeLoad: ({ context }) =>
    redirectToBranch(context.queryClient, '/marketing/gallery'),
});
