import { createFileRoute } from '@tanstack/react-router';

import { WfRetention } from '@/features/wireframes/growth/retention';

/**
 * Wireframe: Retention dashboard.
 *
 * Static review page — fixtures only, no queries, no writes. Not linked from
 * anywhere in the product; delete it once the surface ships for real.
 */
export const Route = createFileRoute('/_authed/dashboard/wireframes/retention')(
  {
    component: WfRetention,
  }
);
