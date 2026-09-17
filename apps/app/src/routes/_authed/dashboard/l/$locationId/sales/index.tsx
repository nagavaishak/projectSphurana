import { createFileRoute, redirect } from '@tanstack/react-router';

import { branchPath } from '@/features/organization-locations/branch-path';

/** Sales defaults to the daily summary. */
export const Route = createFileRoute('/_authed/dashboard/l/$locationId/sales/')(
  {
    beforeLoad: ({ params }) => {
      throw redirect({
        to: branchPath(params.locationId, '/sales/daily-summary'),
      });
    },
  }
);
