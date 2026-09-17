import { createFileRoute } from '@tanstack/react-router';

import { WfConsentPrivacy } from '@/features/wireframes/admin/consent-privacy';

/**
 * `/dashboard/settings/consent-privacy` — renewals, the in-clinic kiosk, and
 * data export / erasure.
 *
 * Distinct from `settings/consent-forms`, which is the TEMPLATE library — what
 * the forms say. This is the operational side: who has signed what, and what we
 * owe them afterwards.
 *
 * The wireframe sits at the surface's real address rather than under
 * `/dashboard/wireframes`, so it can be reached from the sidebar exactly where
 * it will live. Still static — fixtures only, no queries, no writes.
 */
export const Route = createFileRoute(
  '/_authed/dashboard/settings/consent-privacy'
)({
  component: WfConsentPrivacy,
});
