import { createFileRoute } from '@tanstack/react-router';

import { StocktakesPage } from '@/features/inventory';

/**
 * `?take=<id>` opens that stocktake's count sheet on arrival. The create editor
 * (`/create/stock-take`) redirects here with it, so starting a count still
 * lands you in the count — the thing the create dialog used to do by simply
 * swapping one dialog for another.
 */
export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/inventory/stocktakes'
)({
  // Returned as an OPTIONAL key, not `take: string | undefined`: the latter
  // makes `search` mandatory on every navigation to this route, including the
  // legacy /catalog redirect shim.
  validateSearch: (search: Record<string, unknown>): { take?: string } =>
    typeof search.take === 'string' ? { take: search.take } : {},
  component: StocktakesRoute,
});

function StocktakesRoute() {
  const { take } = Route.useSearch();
  return <StocktakesPage initialStockTakeId={take} />;
}
