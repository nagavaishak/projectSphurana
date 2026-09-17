import { ClientContainer } from '@/components/calendar';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/content-calendar/day'
)({
  component: ContentDayPage,
});

function ContentDayPage() {
  return (
    <>
      <title>Day View - Planner | Borradh</title>
      <ClientContainer view="day" basePath="/dashboard/content-calendar" />
    </>
  );
}
