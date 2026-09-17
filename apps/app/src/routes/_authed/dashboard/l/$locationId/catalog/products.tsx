import { createFileRoute } from '@tanstack/react-router';

import { ProductsPage } from '@/features/inventory';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/catalog/products'
)({
  component: ProductsPage,
});
