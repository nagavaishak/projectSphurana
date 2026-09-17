import { createFileRoute } from '@tanstack/react-router';

import { WfDeposits } from '@/features/wireframes/clinic/deposits';

/**
 * Wireframe: the deposits console (§10).
 *
 * Static review page — fixtures only, no queries, no writes. Not linked from
 * anywhere in the product; delete it once the surface ships for real and the
 * "Coming Soon" stub at `/dashboard/l/$locationId/deposits` is replaced.
 */
export const Route = createFileRoute('/_authed/dashboard/wireframes/deposits')({
  component: WfDeposits,
});
