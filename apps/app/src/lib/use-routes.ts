'use client';

import { useRouterState } from '@tanstack/react-router';
import { useMemo } from 'react';

import { useListLocations } from '@/features/organization-locations/api/list-locations/list-locations.hook';
import {
  branchHandle,
  branchIdFromPath,
  findBranchByHandle,
} from '@/features/organization-locations/branch-path';

// Deep import, not the feature barrel: this needs ONE synchronous localStorage
// read, and pulling the barrel drags the whole feature surface (and its React
// Query hooks) into every module that merely builds a link. It also stops a
// spec that mocks the barrel for its own reasons from having to know about a
// helper it never uses.
import { readRememberedLocationHandle } from '@/features/organization-locations/use-active-location';

import { BRANCH_PATHS, type BranchRoutes, branchRoutes } from './route-paths';

/**
 * Branch-scoped paths for the branch the user is currently in.
 *
 * Reads the branch from the URL rather than from `useActiveLocation()`, and the
 * difference matters: this hook is called during render by components that link
 * elsewhere, and the URL is synchronously available while the locations query
 * may still be loading. Sourcing it from the query would make every link in the
 * app briefly point at the wrong branch — or at nothing — on a cold load.
 *
 * Returns `null` on an org-level page (`/dashboard/settings`), because there is
 * genuinely no branch in scope there. Callers that link INTO a branch from such
 * a page should use `useActiveLocation()` instead, which falls back to the
 * remembered or primary branch. Most callers are inside the branch layout and
 * can treat this as always-present.
 */
export function useRoutes(): BranchRoutes | null {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const locationId = branchIdFromPath(pathname);

  return useMemo(
    () => (locationId ? branchRoutes(locationId) : null),
    [locationId]
  );
}

/**
 * The same, for the many call sites that are unconditionally inside the branch
 * layout and would otherwise litter `?.` through their JSX.
 *
 * Throws rather than returning a fallback: rendering a link to the WRONG branch
 * is a silent data-scoping bug, and a loud failure in development is the
 * cheaper outcome. If this throws, the component is being used outside
 * `/dashboard/l/:locationId/` and wants `useRoutes()` (or `useActiveLocation()`).
 */
export function useBranchRoutes(): BranchRoutes {
  const routes = useRoutes();
  if (!routes) {
    throw new Error(
      'useBranchRoutes() called outside a branch route. Use useRoutes() and handle null, or useActiveLocation() to link into a branch from an org-level page.'
    );
  }
  return routes;
}

/**
 * Branch-scoped paths that ALWAYS resolve, for components that render both
 * inside and outside the branch layout — the mobile tab bar, quick-add, and
 * anything else that is chrome rather than page.
 *
 * Resolution order: the branch in the URL, then the REMEMBERED branch, then the
 * un-prefixed paths.
 *
 * Deliberately does NOT consult `useActiveLocation()`, even though that would
 * give a "better" answer via the primary-location fallback. It would drag the
 * locations QUERY into every component that merely renders a link — chrome that
 * mounts on every screen — and make link targets depend on network state. The
 * remembered id is a synchronous localStorage read, and it was written by the
 * branch layout only after the id was validated.
 *
 * After those two, the org's PRIMARY branch, read from the locations query.
 * That arm is last on purpose — the two synchronous reads above still answer
 * first, so cold-start behaviour is unchanged and nothing flickers while the
 * query settles.
 *
 * It exists because the un-prefixed shape below is NOT a safe final answer once
 * the compatibility splat is gone. It reads as a deliberate degrade — the splat
 * catches `/dashboard/calendar/day` and costs one redirect — but the splat is
 * scheduled for deletion, and until then it silently hides the fact that a
 * surface never resolved. It was doing exactly that on the mobile tab bar:
 * every org-level page (`/dashboard/more/*`, `/dashboard/settings`) rendered
 * legacy tab links, and nothing failed.
 */
/**
 * The un-prefixed shape, used when no branch is known. Built explicitly rather
 * than as `branchRoutes('')`, which would produce `/dashboard/l//calendar` —
 * a path that matches nothing and 404s. These are real, working paths that the
 * compatibility splat redirects into the resolved branch.
 */
const FALLBACK_ROUTES: BranchRoutes = {
  ...BRANCH_PATHS,
  customerDetail: (leadId: string) => `${BRANCH_PATHS.customers}/${leadId}`,
  campaignsNew: `${BRANCH_PATHS.campaigns}/new`,
  campaignDetail: (id: string) => `${BRANCH_PATHS.campaigns}/${id}`,
  advertisingCampaign: (id: string) => `${BRANCH_PATHS.advertising}/${id}`,
  advertisingAd: (campaignId: string, adId: string) =>
    `${BRANCH_PATHS.advertising}/${campaignId}/ads/${adId}`,
  socialPost: (id: string) => `${BRANCH_PATHS.socials}/post/${id}`,
};

export function useResolvedRoutes(): BranchRoutes {
  const fromUrl = useRoutes();
  // Only reached when BOTH synchronous reads miss — a cold entry straight onto
  // an org-level page. `useListLocations` is the same cached query the switcher
  // holds, so on any screen that shows the switcher this is already resolved.
  const { locations, isLoading } = useListLocations();
  const primary =
    locations.find((location) => location.isPrimary) ?? locations[0];
  const primaryHandle = primary ? branchHandle(primary) : null;

  /*
    THE REMEMBERED HANDLE IS A GUESS, AND IT MUST BE DROPPED THE MOMENT WE CAN
    PROVE IT WRONG.

    Storage holds the last branch this BROWSER was in — not the last branch this
    USER, or this ORG, was in. It survives signing out, switching account,
    switching org, and the branch being renamed or deleted. Trusted blindly, it
    put a dead handle into every branch link on the page, and the branch layout
    answers a dead handle with `notFound()`: sign in, land on a bare 404, with no
    sidebar and no way back. It STUCK, too — the self-heal below only runs on a
    page that renders, and a 404 never does — so the only escape was clearing
    site data.

    While the query is loading we still trust it: that is the whole point of the
    synchronous read, and one render with a stale-but-plausible link beats a
    render with no branch at all. Once the answer is in, a handle the org does
    not have is worth less than the primary.
  */
  const rememberedHandle = useRememberedBranchHandle(locations, isLoading);

  // Memoised for referential stability, not for the cost of building the
  // object. Callers put `routes.customerDetail` and friends in effect and
  // callback dependency arrays; a fresh object every render would re-run every
  // one of those on every render, and an effect that navigates would loop.
  return useMemo(() => {
    if (fromUrl) return fromUrl;
    if (rememberedHandle) return branchRoutes(rememberedHandle);
    if (primaryHandle) return branchRoutes(primaryHandle);
    return FALLBACK_ROUTES;
  }, [fromUrl, rememberedHandle, primaryHandle]);
}

/**
 * The remembered branch handle, or null once the org's real branches say it is
 * not one of them.
 *
 * Returns a plain string so the caller's `useMemo` stays referentially stable —
 * `locations` is a fresh array on every render while the query is settling.
 */
function useRememberedBranchHandle(
  locations: { id: string; slug?: string | null }[],
  isLoading: boolean
): string | null {
  const remembered = readRememberedLocationHandle();
  if (!remembered) return null;
  if (isLoading) return remembered;
  return findBranchByHandle(locations, remembered) ? remembered : null;
}
