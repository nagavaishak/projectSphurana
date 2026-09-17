import { createFileRoute } from '@tanstack/react-router';

import { WfReports } from '@/features/wireframes/admin/wf-reports';

/**
 * `/dashboard/reports` — Revenue, clients, treatments and marketing ROI (§18).
 *
 * This is where the surface WILL live, so the wireframe sits at its real
 * address rather than under `/dashboard/wireframes`. It is still static —
 * fixtures only, no queries, no writes — and the floating bar marks it as a
 * wireframe. Replace the component when the real one is built; the route and
 * its sidebar entry stay.
 */
export const Route = createFileRoute('/_authed/dashboard/reports')({
  component: WfReports,
});
