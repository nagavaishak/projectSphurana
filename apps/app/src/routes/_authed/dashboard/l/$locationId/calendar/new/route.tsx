import { Outlet, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

import { useBranchRoutes } from '@/lib/use-routes';

import { useIsMobile } from '@/hooks/use-mobile';

import { appointmentCreateSearchSchema } from '../-components/appointment-create-search';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/calendar/new'
)({
  validateSearch: (search) => appointmentCreateSearchSchema.parse(search),
  component: AppointmentNewLayout,
});

function AppointmentNewLayout() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const routes = useBranchRoutes();

  useEffect(() => {
    if (!isMobile) {
      void navigate({ to: routes.calendarDay, replace: true });
    }
  }, [isMobile, navigate, routes]);

  if (!isMobile) {
    return null;
  }

  return <Outlet />;
}
