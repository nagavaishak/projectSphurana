import { ClientContainer } from '@/components/calendar';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/content-calendar/month'
)({
  component: ContentMonthPage,
});

function ContentMonthPage() {
  return (
    <>
      <title>Month View - Planner | Borradh</title>
      <ClientContainer view="month" basePath="/dashboard/content-calendar" />
    </>
  );
}
