import { ClientContainer } from '@/components/calendar';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/calendar/three-day'
)({
  component: AppointmentsThreeDayPage,
});

function AppointmentsThreeDayPage() {
  return (
    <>
      <title>3 Day View - Appointments | Borradh</title>
      <ClientContainer view="3day" basePath="/dashboard/calendar" />
    </>
  );
}
