import { Outlet, createFileRoute } from '@tanstack/react-router';

import { ContentCalendarProvider } from '@/features/content-calendar';

/**
 * Content planner layout. Mirrors the appointments calendar: one shared
 * provider wraps nested per-view routes (day / three-day / week / month).
 * Pages stand in for staff; the reused calendar components render them as
 * resource columns/rows.
 */
export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/content-calendar'
)({
  component: ContentCalendarLayout,
});

function ContentCalendarLayout() {
  return (
    <ContentCalendarProvider>
      <div className="flex h-full flex-col">
        <Outlet />
      </div>
    </ContentCalendarProvider>
  );
}
