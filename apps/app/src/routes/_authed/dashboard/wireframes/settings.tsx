import { createFileRoute } from '@tanstack/react-router';

import { WfSettings } from '@/features/wireframes/admin/wf-settings';

export const Route = createFileRoute('/_authed/dashboard/wireframes/settings')({
  component: SettingsWireframe,
});

/**
 * §5 — the ten-sub-page settings IA, plus the service and booking-page deltas.
 *
 * No `DashboardPage` here: the wireframe renders its own.
 */
function SettingsWireframe() {
  return (
    <>
      <title>Settings wireframe | Borradh</title>
      <WfSettings />
    </>
  );
}
