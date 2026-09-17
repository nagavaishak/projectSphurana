import { createFileRoute } from '@tanstack/react-router';

import { WfConsentKiosk } from '@/features/wireframes/admin/wf-consent-kiosk';

/**
 * Wireframe: in-clinic kiosk consent fill (§17.4) — a FULL-SCREEN surface.
 *
 * A sibling of `/dashboard`, never a child. The patient is holding the iPad, so
 * there must be no sidebar, no nav, and no way out except the staff PIN —
 * otherwise they can wander into another patient's record. That is why this
 * route sits here and why the component ships no close control.
 *
 * Static review page. Delete when the surface ships for real.
 */
export const Route = createFileRoute(
  '/_authed/wireframe-fullscreen/consent-kiosk'
)({
  component: WfConsentKiosk,
});
