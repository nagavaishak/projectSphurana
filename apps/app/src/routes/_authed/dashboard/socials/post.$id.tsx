import { createFileRoute } from '@tanstack/react-router';

import { redirectToBranch } from '@/features/organization-locations/redirect-to-branch';

/** Moved under the branch prefix. Kept as a redirect for old links. */
export const Route = createFileRoute('/_authed/dashboard/socials/post/$id')({
  beforeLoad: ({ params, context }) =>
    redirectToBranch(
      context.queryClient,
      `/marketing/socials/post/${params.id}`
    ),
});
