import { createFileRoute } from '@tanstack/react-router';

import { StockOrdersPage } from '@/features/inventory';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/inventory/stock-orders'
)({
  component: StockOrdersPage,
});
