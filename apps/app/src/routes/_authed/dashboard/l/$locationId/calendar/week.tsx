import { ClientContainer } from '@/components/calendar';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/calendar/week'
)({
  component: AppointmentsWeekPage,
});

function AppointmentsWeekPage() {
  return (
    <>
      <title>Week View - Appointments | Borradh</title>
      <ClientContainer view="week" basePath="/dashboard/calendar" />
    </>
  );
}
