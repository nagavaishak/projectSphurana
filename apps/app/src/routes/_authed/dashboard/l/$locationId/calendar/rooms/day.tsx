import { ClientContainer } from '@/components/calendar';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/calendar/rooms/day'
)({
  component: RoomsDayPage,
});

function RoomsDayPage() {
  return (
    <>
      <title>Day View - Rooms | Borradh</title>
      <ClientContainer view="day" basePath="/dashboard/calendar/rooms" />
    </>
  );
}
