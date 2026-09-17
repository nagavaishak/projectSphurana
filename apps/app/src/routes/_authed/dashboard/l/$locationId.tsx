import { Outlet, createFileRoute, notFound } from '@tanstack/react-router';

import { listLocationsQueryOptions } from '@/features/organization-locations/api/list-locations/list-locations.hook';
import {
  branchHandle,
  findBranchByHandle,
} from '@/features/organization-locations/branch-path';
import { rememberActiveLocationId } from '@/features/organization-locations/use-active-location';

/**
 * The branch layout: everything under `/dashboard/l/:locationId/…` is scoped to
 * one location.
 *
 * WHY A LITERAL `l/` SEGMENT rather than `/dashboard/$locationId`. Without it a
 * location id could shadow a static sibling — an org whose branch id happened
 * to be `settings` would make `/dashboard/settings` ambiguous, and TanStack
 * resolves that in favour of the static route, so the branch would simply be
 * unreachable with no error. The extra segment removes the class of bug.
 *
 * WHY IT NESTS INSIDE `dashboard.tsx` rather than replacing it: the sidebar
 * lives there. Nesting means switching branch re-renders the CONTENT and leaves
 * the shell mounted — no sidebar flash, no scroll reset, no re-fetch of the nav.
 *
 * `beforeLoad` is where the id stops being attacker-controlled. It is a URL
 * segment, so anyone can type one; resolving it against the org's real
 * locations here means no child route, loader or component ever has to wonder.
 * The API re-checks it independently (`LocationGuard`) — this is the client's
 * own 404, not a security boundary standing alone.
 */
export const Route = createFileRoute('/_authed/dashboard/l/$locationId')({
  beforeLoad: async ({ params, context }) => {
    const { locationId } = params;

    // `ensureQueryData` rather than a bare fetch: the sidebar's switcher reads
    // the same query, so a branch switch costs zero extra requests and the
    // 404 check is served from the cache it already warmed.
    const data = await context.queryClient.ensureQueryData(
      listLocationsQueryOptions()
    );

    // The segment is a readable SLUG where the branch has one, else its id —
    // both resolve, for the reasons on `findBranchByHandle`.
    const location = findBranchByHandle(data.items, locationId);
    if (!location) {
      // A deleted branch, a stale bookmark, or another org's id. All three are
      // "this page does not exist for you" — not an error worth a stack trace.
      throw notFound();
    }

    // Last-used branch, so a bare `/dashboard/x` (or a cold start) returns the
    // user to the branch they were in rather than the org's primary. Written
    // here, on the way in, because this is the one place that has BOTH a
    // validated id and every entry point funnelling through it.
    // Remember the real ID, never the handle: a slug can be renamed, and a
    // stored slug would then resolve to nothing on the next cold start.
    rememberActiveLocationId(location.id, branchHandle(location));

    return { locationId: location.id, location };
  },
  component: BranchLayout,
});

function BranchLayout() {
  return <Outlet />;
}
