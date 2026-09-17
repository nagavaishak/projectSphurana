import { Outlet, createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing'
)({
  component: MarketingLayout,
});

function MarketingLayout() {
  return <Outlet />;
}
