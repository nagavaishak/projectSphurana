import { createFileRoute } from '@tanstack/react-router';

import { WfDeposits } from '@/features/wireframes/clinic/deposits';

/**
 * The deposits console, mounted over the "Coming Soon" empty state this route
 * used to render.
 *
 * That placeholder was the problem, not a placeholder: `apps/api/src/deposits`
 * is finished and deposits are being taken in production today, while this page
 * told the owner the feature did not exist. See docs/handoffs/shop.md §4 and
 * booking-surfaces §10.
 *
 * Still a wireframe — static fixtures, nothing charges — but it renders where
 * the real console goes, so the placement and the tab set can be judged.
 */
export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/deposits'
)({
  component: WfDeposits,
});
