import { createFileRoute } from '@tanstack/react-router';

import { SuppliersPage } from '@/features/inventory';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/inventory/suppliers'
)({
  component: SuppliersPage,
});
