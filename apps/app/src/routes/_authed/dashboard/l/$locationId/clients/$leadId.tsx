import { useBranchRoutes } from '@/lib/use-routes';
import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * Redirect shim. The client profile moved to `/dashboard/customers/$leadId`
 * with the unified Clients surface. This path is the one most likely to be
 * deep-linked — it is what every "view this client" link we have ever sent
 * points at — so it forwards rather than 404s. See `clients/list.tsx`.
 */
export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/clients/$leadId'
)({
  beforeLoad: ({ params }) => {
    const routes = useBranchRoutes();
    throw redirect({
      to: routes.customerDetail(params.leadId),
    });
  },
});
