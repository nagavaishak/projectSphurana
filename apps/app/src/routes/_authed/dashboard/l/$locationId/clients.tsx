import { Outlet, createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/clients'
)({
  component: ClientsLayout,
});

function ClientsLayout() {
  return <Outlet />;
}
