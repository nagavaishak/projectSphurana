import { ClientContainer } from '@/components/calendar';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/calendar/agenda'
)({
  component: AppointmentsAgendaPage,
});

function AppointmentsAgendaPage() {
  return (
    <>
      <title>Agenda View - Appointments | Borradh</title>
      <ClientContainer view="agenda" basePath="/dashboard/calendar" />
    </>
  );
}
