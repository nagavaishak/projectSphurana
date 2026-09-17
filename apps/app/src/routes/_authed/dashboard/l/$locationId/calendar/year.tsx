import { ClientContainer } from '@/components/calendar';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/calendar/year'
)({
  component: AppointmentsYearPage,
});

function AppointmentsYearPage() {
  return (
    <>
      <title>Year View - Appointments | Borradh</title>
      <ClientContainer view="year" basePath="/dashboard/calendar" />
    </>
  );
}
