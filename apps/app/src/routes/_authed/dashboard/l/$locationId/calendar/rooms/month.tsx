import { ClientContainer } from '@/components/calendar';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/calendar/rooms/month'
)({
  component: RoomsMonthPage,
});

function RoomsMonthPage() {
  return (
    <>
      <title>Month View - Rooms | Borradh</title>
      <ClientContainer view="month" basePath="/dashboard/calendar/rooms" />
    </>
  );
}
