import { micrositeBookingUrl } from '@/lib/microsite-url';
import { Outlet, createFileRoute } from '@tanstack/react-router';

import { useActiveOrganization } from '@/features/organization/api/get-active-organization';

import { AppointmentsProvider } from './calendar/-components/appointments-provider';
import { BookingEmptyState } from './calendar/-components/booking-empty-state';

/**
 * Appointments layout route. Mirrors the Next.js layout at
 * `apps/web/src/app/(protected)/dashboard/appointments/layout.tsx`:
 * the full calendar only renders when the org's primary calendar is Borradh's
 * built-in one. Every other provider (Google, Calendly, etc.) gets a stub that
 * exposes the booking link.
 *
 * Routing strategy: **Option A** (per Window 2C brief) — nested file routes for
 * each view mode (`agenda`, `day`, `week`, `month`, `year`). One file per view,
 * one shared layout route here. The index route under
 * `appointments/index.tsx` redirects to `appointments/month`.
 */
export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/calendar'
)({
  /**
   * `?date=YYYY-MM-DD` — the day to open on.
   *
   * The calendar always started on `new Date()`, so this param was accepted by
   * the router and then ignored: a link to a specific day, shared with a
   * colleague or bookmarked, silently opened on today. Nothing said the date
   * had been dropped, which is the worst version — the reader believes they are
   * looking at the day they were sent.
   *
   * Parsed permissively and DISCARDED when unusable rather than throwing: a
   * mistyped date in a URL should land you on today's calendar, not on an error
   * page. Declared on the layout so every child view (day/week/month/agenda,
   * and the rooms calendar beneath it) inherits it.
   */
  validateSearch: (search: Record<string, unknown>): { date?: string } => {
    const raw = search.date;
    if (typeof raw !== 'string') return {};
    return Number.isNaN(new Date(raw).getTime()) ? {} : { date: raw };
  },
  component: AppointmentsLayout,
});

const PROVIDER_NAMES: Record<string, string> = {
  google_calendar: 'Google Calendar',
  calendly: 'Calendly',
  timely: 'Timely',
  fresha: 'Fresha',
  phorest: 'Phorest',
};

function AppointmentsLayout() {
  // GUARDED TWICE, on purpose. `validateSearch` above drops an unparseable
  // `date`, but this component must not depend on that being the only way a
  // bad value can arrive: an Invalid Date reaching `selectedDate` crashes the
  // whole calendar, because `listAppointmentsQueryOptions` calls
  // `toISOString()` on the range it derives and that throws `RangeError:
  // Invalid time value`. The error boundary then replaces the page with "We
  // could not load the dashboard" — a hard failure for nothing worse than a
  // typo in a URL. Fall back to today instead.
  const { date } = Route.useSearch();
  const parsedDate = date ? new Date(date) : undefined;
  const initialDate =
    parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : undefined;
  const { data: organization } = useActiveOrganization();
  const calendarType = organization?.primaryCalendarType;

  if (calendarType !== 'borradh') {
    // The link we hand out is the clinic's booking page — the page leads
    // actually book through — NOT the calendar. It lives on the MARKETING host
    // under the microsite base now; the old app-host shape only resolves via a
    // redirect, and a link a clinic shares should not depend on one. Falls back
    // to the org's configured booking link when there is no slug to build one.
    const bookingLink = organization?.slug
      ? micrositeBookingUrl(organization.slug)
      : organization?.defaultBookingLink;

    return (
      <div className="flex h-full flex-col p-4">
        <BookingEmptyState
          bookingLink={bookingLink}
          providerName={calendarType ? PROVIDER_NAMES[calendarType] : undefined}
        />
      </div>
    );
  }

  return (
    <AppointmentsProvider initialDate={initialDate}>
      <div className="flex h-full flex-col">
        <Outlet />
      </div>
    </AppointmentsProvider>
  );
}
