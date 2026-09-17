import { createFileRoute } from '@tanstack/react-router';

import { WfReviews } from '@/features/wireframes/growth/reviews';

/**
 * `/dashboard/reviews` — Negative feedback first; ratings and Google routing behind it (§16).
 *
 * This is where the surface WILL live, so the wireframe sits at its real
 * address rather than under `/dashboard/wireframes`. It is still static —
 * fixtures only, no queries, no writes — and the floating bar marks it as a
 * wireframe. Replace the component when the real one is built; the route and
 * its sidebar entry stay.
 */
export const Route = createFileRoute('/_authed/dashboard/reviews')({
  component: WfReviews,
});
