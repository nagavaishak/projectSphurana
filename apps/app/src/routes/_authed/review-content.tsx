import { useResolvedRoutes } from '@/lib/use-routes';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { ReviewWorkspace } from '@/features/content-batches';

/**
 * Bulk content review — deliberately a SIBLING of `/dashboard`, not a child.
 *
 * Routes under `_authed/dashboard` inherit `DashboardLayoutShell` (primary
 * sidebar + site header), and this screen needs the whole viewport: the queue,
 * the post and Claire's thread are three columns of their own, and a nav rail
 * beside a queue rail reads as two competing lists. Same reasoning as
 * `/create-video` and `/record`, which sit here for the same reason.
 */
export const Route = createFileRoute('/_authed/review-content')({
  component: ReviewContentPage,
});

function ReviewContentPage() {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();

  const backToPlanner = () => void navigate({ to: routes.contentCalendar });

  return (
    <>
      <title>Review Content | Borradh</title>
      {/* With no sidebar there is no ambient way out, so the workspace owns
          both its exits: the back control in its header, and finishing the
          queue. Both land back on the planner the batch belongs to. */}
      <ReviewWorkspace onBack={backToPlanner} onDone={backToPlanner} />
    </>
  );
}
