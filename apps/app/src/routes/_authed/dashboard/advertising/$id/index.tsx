import { createFileRoute } from '@tanstack/react-router';

import { redirectToBranch } from '@/features/organization-locations/redirect-to-branch';

/** Moved under the branch prefix. Kept as a redirect for old links. */
export const Route = createFileRoute('/_authed/dashboard/advertising/$id/')({
  beforeLoad: ({ params, context }) =>
    redirectToBranch(
      context.queryClient,
      `/marketing/advertising/${params.id}`
    ),
});
