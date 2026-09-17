import { createFileRoute, redirect } from '@tanstack/react-router';

import {
  branchHandle,
  branchPath,
} from '@/features/organization-locations/branch-path';
import { resolveEntryBranch } from '@/features/organization-locations/resolve-entry-branch';
import { readRememberedLocationId } from '@/features/organization-locations/use-active-location';
import { ROUTES } from '@/lib/route-paths';

/**
 * COMPATIBILITY SPLAT — the thing that makes the URL move survivable.
 *
 * Every branch-scoped page moved from `/dashboard/x` to `/dashboard/l/:id/x`.
 * Without this route, that single change would break: every bookmark, every
 * link in an email we have already sent, 274 e2e path references, and every
 * one of the ~1000 hardcoded `/dashboard/…` strings still in the app. This
 * catches them all and re-issues to the resolved branch.
 *
 * WHY A SPLAT IS SAFE HERE. TanStack matches specific routes before a splat, so
 * the org-level pages that deliberately stay outside the prefix — `settings/*`,
 * `account`, `more`, `locations/*`, `debug`, `reset` — keep matching their own
 * routes and never reach this. Only a path that matches NOTHING falls through,
 * which after the move is exactly the set of legacy branch paths.
 *
 * It is also the 404 route by consequence: a genuine typo redirects to the
 * branch and 404s there instead of here. That is the better of the two — the
 * user lands inside the app with the sidebar, not on a bare error page.
 *
 * TEMPORARY BY DESIGN (plan §10, risk 2): it lands FIRST and stays for a
 * release while call sites convert, and the lint rule banning literal
 * `/dashboard/` paths lands LAST. Deleting it before then re-breaks the
 * bookmarks it exists to protect.
 */
export const Route = createFileRoute('/_authed/dashboard/$')({
  beforeLoad: async ({ params, context }) => {
    const branch = await resolveEntryBranch(
      context.queryClient,
      readRememberedLocationId()
    );

    // No branch to send them to (org mid-onboarding). `/dashboard/locations` is
    // org-level and matches its own route, so it cannot bounce back here — the
    // loop this guard used to fear is not reachable through it, and a 404 is
    // not a reasonable answer to "you have no branches yet".
    //
    // The SAME answer as `/dashboard` itself, deliberately: `resolveEntryBranch`
    // exists so a bookmark and a bare `/dashboard` cannot disagree about where
    // you land, and that guarantee has to hold for the no-branch case too.
    if (!branch) throw redirect({ to: ROUTES.locations });

    const splat = params._splat ?? '';

    // ALREADY branch-scoped → let it 404, do not re-prefix.
    //
    // This splat catches anything under `/dashboard` that matched no route.
    // `/dashboard/l/<branch>/nonsense` is such a path, so without this guard it
    // came back here and got another `/l/<branch>` prepended, and again, and
    // again: `/dashboard/l/main/l/main/l/main/…` several hundred segments deep.
    // Every unknown dashboard URL — a typo, a stale bookmark, a legacy deep
    // link whose target moved — became an unbounded redirect loop instead of a
    // not-found.
    //
    // The comment above already says a loop is far worse than a 404; it only
    // guarded the no-branch case. This is the other door into the same trap.
    if (splat === 'l' || splat.startsWith('l/')) return;

    throw redirect({ to: branchPath(branchHandle(branch), `/${splat}`) });
  },
});
