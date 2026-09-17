import { Outlet, createFileRoute } from '@tanstack/react-router';

/**
 * Services layout — list at `services/index`, mobile forms at `new`,
 * `$serviceId/edit`, and offer routes under `offers/*`.
 */
export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/catalog/services'
)({
  component: ServicesLayout,
});

function ServicesLayout() {
  return <Outlet />;
}
