import { ClientContainer } from '@/components/calendar';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/content-calendar/week'
)({
  component: ContentWeekPage,
});

function ContentWeekPage() {
  return (
    <>
      <title>Week View - Planner | Borradh</title>
      <ClientContainer view="week" basePath="/dashboard/content-calendar" />
    </>
  );
}
