import { ClientContainer } from '@/components/calendar';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/calendar/rooms/week'
)({
  component: RoomsWeekPage,
});

function RoomsWeekPage() {
  return (
    <>
      <title>Week View - Rooms | Borradh</title>
      <ClientContainer view="week" basePath="/dashboard/calendar/rooms" />
    </>
  );
}
