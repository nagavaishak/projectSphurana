import { ClientContainer } from '@/components/calendar';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/content-calendar/three-day'
)({
  component: ContentThreeDayPage,
});

function ContentThreeDayPage() {
  return (
    <>
      <title>3 Day View - Planner | Borradh</title>
      <ClientContainer view="3day" basePath="/dashboard/content-calendar" />
    </>
  );
}
