import { createFileRoute } from '@tanstack/react-router';

import { WfReports } from '@/features/wireframes/admin/wf-reports';

export const Route = createFileRoute('/_authed/dashboard/wireframes/reports')({
  component: ReportsWireframe,
});

/**
 * §18 — the four reporting tabs behind one shared toolbar. Fixtures only.
 *
 * No `DashboardPage` here: the wireframe renders its own, and nesting two
 * produces two page headers.
 */
function ReportsWireframe() {
  return (
    <>
      <title>Reports wireframe | Borradh</title>
      <WfReports />
    </>
  );
}
