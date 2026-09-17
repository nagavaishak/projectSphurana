import { Outlet, createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/marketing/socials'
)({
  component: SocialsLayout,
});

function SocialsLayout() {
  return <Outlet />;
}
