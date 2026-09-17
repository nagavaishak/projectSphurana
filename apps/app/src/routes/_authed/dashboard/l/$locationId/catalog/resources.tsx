import { createFileRoute } from '@tanstack/react-router';

import { ResourcesPage } from '@/features/resources/components';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/catalog/resources'
)({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <>
      <title>Rooms &amp; equipment | Borradh</title>
      <ResourcesPage />
    </>
  );
}
