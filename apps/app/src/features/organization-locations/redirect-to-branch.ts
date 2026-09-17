import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';

import { branchHandle, branchPath } from './branch-path.js';
import { resolveEntryBranch } from './resolve-entry-branch.js';
import { readRememberedLocationId } from './use-active-location.js';

/**
 * Throw a redirect into the current branch at `subPath` (`/calendar/day`).
 *
 * For the legacy shim routes — `/dashboard/appointments/*` and friends — that
 * still have their own route files and therefore never reach the compatibility
 * splat. They cannot simply point at the old un-prefixed path either: that path
 * no longer exists, so it would bounce through the splat and cost a second
 * redirect on every visit.
 *
 * Falls through (returns) when the org has no branches, leaving the caller's
 * route to render or 404 rather than redirecting into a path that would bounce
 * straight back — a loop is worse than a not-found.
 */
export async function redirectToBranch(
  queryClient: QueryClient,
  subPath: string
): Promise<void> {
  const branch = await resolveEntryBranch(
    queryClient,
    readRememberedLocationId()
  );
  if (!branch) return;
  throw redirect({ to: branchPath(branchHandle(branch), subPath) });
}
