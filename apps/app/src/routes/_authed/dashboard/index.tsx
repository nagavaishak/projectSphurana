import { createFileRoute, redirect } from '@tanstack/react-router';

import {
  branchHandle,
  branchPath,
} from '@/features/organization-locations/branch-path';
import { resolveEntryBranch } from '@/features/organization-locations/resolve-entry-branch';
import { readRememberedLocationId } from '@/features/organization-locations/use-active-location';
import { ROUTES } from '@/lib/route-paths';

/**
 * `/dashboard` has no page of its own — it resolves a branch and sends you to
 * that branch's home.
 *
 * The org may legitimately have NO locations (mid-onboarding). That must not
 * dead-end — and it did. The fallback used to be `BRANCH_PATHS.home`, which is
 * NOT a route: `BRANCH_PATHS` holds the un-prefixed TEMPLATE strings that
 * `branchRoutes()` re-roots under `/dashboard/l/:handle/`. `/dashboard/home`
 * matches nothing, so it fell through to the compatibility splat, which
 * resolves the same branch, still finds none, and deliberately declines to
 * redirect. The result was a bare 404 the moment a location-less org signed in.
 *
 * `/dashboard/locations` is the honest destination: it is org-level by design
 * ("you come here to add or switch a location, so it must not itself sit behind
 * a selected location"), it is a real route so it cannot bounce back here, and
 * it is where someone with no branches actually needs to be.
 */
export const Route = createFileRoute('/_authed/dashboard/')({
  beforeLoad: async ({ context }) => {
    const branch = await resolveEntryBranch(
      context.queryClient,
      readRememberedLocationId()
    );
    throw redirect({
      to: branch ? branchPath(branchHandle(branch), '/home') : ROUTES.locations,
    });
  },
});
