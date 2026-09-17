import { createFileRoute } from '@tanstack/react-router';

import { ProductBrandsPage } from '@/features/inventory';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/inventory/brands'
)({
  component: ProductBrandsPage,
});
