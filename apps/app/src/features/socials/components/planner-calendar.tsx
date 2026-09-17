import { ClientContainer } from '@/components/calendar';
import { ContentCalendarProvider } from '@/features/content-calendar';

/**
 * The "Calendar" tab of the Planner — the reusable calendar with Meta pages
 * as resource columns/rows. Defaults to the week view; the view switcher
 * navigates into the dedicated content-calendar route tree. Reuses
 * {@link ContentCalendarProvider} for data, Meta gating and drag-to-reschedule.
 */
export function PlannerCalendar() {
  return (
    <div className="h-[calc(100vh-13rem)] min-h-[32rem] overflow-hidden rounded-lg border">
      <ContentCalendarProvider>
        <ClientContainer view="week" basePath="/dashboard/content-calendar" />
      </ContentCalendarProvider>
    </div>
  );
}
