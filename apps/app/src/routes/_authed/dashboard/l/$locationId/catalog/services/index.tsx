import { createFileRoute } from '@tanstack/react-router';

import { ServicesPage } from '@/features/services-dashboard';
import { ServicesMobilePage } from '@/features/services-dashboard/mobile';
import { useIsMobile } from '@/hooks/use-mobile';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/catalog/services/'
)({
  component: ServicesRoute,
});

function ServicesRoute() {
  const isMobile = useIsMobile();

  // The mobile list is the only surface that links to the mobile add/edit
  // funnel (ROUTES.servicesNew / serviceEditPath) — without this switch those
  // routes are unreachable and phones get the desktop category sidebar.
  return isMobile ? <ServicesMobilePage /> : <ServicesPage />;
}
