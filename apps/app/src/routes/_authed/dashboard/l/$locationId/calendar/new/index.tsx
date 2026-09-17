import { createFileRoute } from '@tanstack/react-router';

import { AppointmentMobileCreateDetails } from '../-components/appointment-mobile-create-details';
import { AppointmentMobileSelectClient } from '../-components/appointment-mobile-select-client';
import { AppointmentMobileSelectPractitioner } from '../-components/appointment-mobile-select-practitioner';
import { AppointmentMobileSelectService } from '../-components/appointment-mobile-select-service';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/calendar/new/'
)({
  component: AppointmentNewIndexPage,
});

/**
 * Mobile create-appointment funnel: client → service → team member → details.
 *
 * `practitionerId` is carried in the search params through every step. When the
 * flow is opened from a staff column it's pre-seeded, so the team-member step is
 * skipped and the booking is assigned + tinted exactly as it is on desktop.
 */
function AppointmentNewIndexPage() {
  const search = Route.useSearch();

  if (search.leadId && search.serviceId && search.practitionerId) {
    return (
      <>
        <title>Create Appointment | Borradh</title>
        <AppointmentMobileCreateDetails search={search} />
      </>
    );
  }

  if (search.leadId && search.serviceId) {
    return (
      <>
        <title>Select Team Member | Borradh</title>
        <AppointmentMobileSelectPractitioner search={search} />
      </>
    );
  }

  if (search.leadId) {
    return (
      <>
        <title>Select Service | Borradh</title>
        <AppointmentMobileSelectService search={search} />
      </>
    );
  }

  return (
    <>
      <title>Select Client | Borradh</title>
      <AppointmentMobileSelectClient search={search} />
    </>
  );
}
