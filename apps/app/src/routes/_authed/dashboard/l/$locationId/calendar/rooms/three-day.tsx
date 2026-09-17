import { ClientContainer } from '@/components/calendar';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/calendar/rooms/three-day'
)({
  component: Rooms3DayPage,
});

function Rooms3DayPage() {
  return (
    <>
      <title>3 Day View - Rooms | Borradh</title>
      <ClientContainer view="3day" basePath="/dashboard/calendar/rooms" />
    </>
  );
}
