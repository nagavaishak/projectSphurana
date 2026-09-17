import { createFileRoute } from '@tanstack/react-router';

import { PromotionsPage } from '@/features/offers';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/catalog/offers'
)({
  component: PromotionsPage,
});
