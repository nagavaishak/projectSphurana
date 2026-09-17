import { useBranchRoutes } from '@/lib/use-routes';
import { createFileRoute, redirect } from '@tanstack/react-router';

/** Next `step-configure` pushes here; list UI lives under `/dashboard/content/videos`. */
export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/videos/'
)({
  beforeLoad: () => {
    const routes = useBranchRoutes();
    throw redirect({ to: routes.contentGallery });
  },
});
