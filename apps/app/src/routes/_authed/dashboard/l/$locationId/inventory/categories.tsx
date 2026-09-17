import { createFileRoute } from '@tanstack/react-router';

import { ProductCategoriesPage } from '@/features/inventory';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/inventory/categories'
)({
  component: ProductCategoriesPage,
});
