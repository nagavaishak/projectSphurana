import { createFileRoute } from '@tanstack/react-router';

import { AppointmentView } from '@/features/appointments/components/appointment-view';

/**
 * The appointment full view, under the branch calendar — which is what you
 * click through from. The side panel stays: skimming and editing without
 * losing your place in the day is what it is for. This is where you *read* one.
 */
export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/calendar/appointment/$appointmentId'
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { appointmentId } = Route.useParams();
  return <AppointmentView appointmentId={appointmentId} />;
}
