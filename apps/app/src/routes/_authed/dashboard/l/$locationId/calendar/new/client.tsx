import { createFileRoute } from '@tanstack/react-router';

import { AppointmentMobileCreateClient } from '../-components/appointment-mobile-create-client';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/calendar/new/client'
)({
  component: AppointmentNewClientPage,
});

function AppointmentNewClientPage() {
  const search = Route.useSearch();

  return (
    <>
      <title>Create New Client | Borradh</title>
      <AppointmentMobileCreateClient search={search} />
    </>
  );
}
