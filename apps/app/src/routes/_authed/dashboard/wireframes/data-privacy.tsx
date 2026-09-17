import { createFileRoute } from '@tanstack/react-router';

import { WfDataPrivacy } from '@/features/wireframes/admin/wf-data-privacy';

export const Route = createFileRoute(
  '/_authed/dashboard/wireframes/data-privacy'
)({
  component: DataPrivacyWireframe,
});

/**
 * §21 — clinic data export, and GDPR erasure.
 *
 * No `DashboardPage` here: the wireframe renders its own.
 */
function DataPrivacyWireframe() {
  return (
    <>
      <title>Data &amp; privacy wireframe | Borradh</title>
      <WfDataPrivacy />
    </>
  );
}
