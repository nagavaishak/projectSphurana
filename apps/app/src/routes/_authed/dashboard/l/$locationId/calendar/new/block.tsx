import { createFileRoute } from '@tanstack/react-router';

import { AppointmentMobileBlockTime } from '../-components/appointment-mobile-block-time';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/calendar/new/block'
)({
  component: AppointmentNewBlockPage,
});

function AppointmentNewBlockPage() {
  const search = Route.useSearch();

  return (
    <>
      <title>Block Time Off | Borradh</title>
      <AppointmentMobileBlockTime search={search} />
    </>
  );
}
