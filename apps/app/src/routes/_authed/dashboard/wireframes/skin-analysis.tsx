import { createFileRoute } from '@tanstack/react-router';

import { SkinAnalysisWireframe } from '@/features/wireframes/consultation/skin-analysis';

export const Route = createFileRoute(
  '/_authed/dashboard/wireframes/skin-analysis'
)({
  component: SkinAnalysisRoute,
});

/** `/dashboard/wireframes/skin-analysis` — scan, analysis and report (§19). */
function SkinAnalysisRoute() {
  return <SkinAnalysisWireframe />;
}
