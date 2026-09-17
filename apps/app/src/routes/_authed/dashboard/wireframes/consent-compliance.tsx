import { createFileRoute } from '@tanstack/react-router';

import { WfConsentCompliance } from '@/features/wireframes/admin/wf-consent-compliance';

export const Route = createFileRoute(
  '/_authed/dashboard/wireframes/consent-compliance'
)({
  component: ConsentComplianceWireframe,
});

/**
 * §17.3 — the re-consent queue.
 *
 * The §17.4 kiosk used to live here too. It is a full-screen surface handed to
 * a patient and must not render the dashboard sidebar, so it now sits in
 * `features/wireframes/admin/wf-consent-kiosk.tsx` and needs a route beside the
 * consultation ones under `/wireframe-fullscreen`.
 *
 * No `DashboardPage`: the queue is a `ListPage`, which renders its own.
 */
function ConsentComplianceWireframe() {
  return (
    <>
      <title>Re-consent queue wireframe | Borradh</title>
      <WfConsentCompliance />
    </>
  );
}
