import { createFileRoute } from '@tanstack/react-router';

import { WfRetention } from '@/features/wireframes/growth/retention';

/**
 * `/dashboard/retention` — Who is slipping away, and who is due a rebooking prompt (§13).
 *
 * This is where the surface WILL live, so the wireframe sits at its real
 * address rather than under `/dashboard/wireframes`. It is still static —
 * fixtures only, no queries, no writes — and the floating bar marks it as a
 * wireframe. Replace the component when the real one is built; the route and
 * its sidebar entry stay.
 */
export const Route = createFileRoute('/_authed/dashboard/retention')({
  component: WfRetention,
});
