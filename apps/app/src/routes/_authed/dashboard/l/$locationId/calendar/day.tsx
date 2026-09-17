import { ClientContainer } from '@/components/calendar';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/calendar/day'
)({
  component: AppointmentsDayPage,
});

function AppointmentsDayPage() {
  return (
    <>
      <title>Day View - Appointments | Borradh</title>
      <ClientContainer view="day" basePath="/dashboard/calendar" />
    </>
  );
}
