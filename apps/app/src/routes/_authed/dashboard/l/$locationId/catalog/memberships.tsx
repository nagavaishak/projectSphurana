import { createFileRoute } from '@tanstack/react-router';

import { MembershipsPage } from '@/features/memberships';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/catalog/memberships'
)({
  component: MembershipsPage,
});
