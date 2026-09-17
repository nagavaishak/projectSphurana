import { createFileRoute } from '@tanstack/react-router';

import { WfSequences } from '@/features/wireframes/growth/sequences';

/**
 * Wireframe: automated client journey sequences (§14) — the clinic's
 * read-and-pause list and the internal builder, on one page for review.
 *
 * Static review page — fixtures only, no queries, no writes. Not linked from
 * anywhere in the product; delete it once the surface ships for real.
 */
export const Route = createFileRoute('/_authed/dashboard/wireframes/sequences')(
  {
    component: WfSequences,
  }
);
