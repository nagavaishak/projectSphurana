import { ClientContainer } from '@/components/calendar';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/calendar/month'
)({
  component: AppointmentsMonthPage,
});

function AppointmentsMonthPage() {
  return (
    <>
      <title>Month View - Appointments | Borradh</title>
      <ClientContainer view="month" basePath="/dashboard/calendar" />
    </>
  );
}
