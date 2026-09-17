import { stripBranchFromPath } from '@/features/organization-locations/branch-path';
import { BRANCH_PATHS, ROUTES } from '@/lib/route-paths';

/**
 * Pathnames that light up one of the five bottom tabs.
 * Keep in sync with `MobileBottomTabs` tab links.
 */
export const MOBILE_BOTTOM_TAB_PATHS = [
  ROUTES.dashboard,
  BRANCH_PATHS.home,
  BRANCH_PATHS.conversations,
  BRANCH_PATHS.calendarDay,
  BRANCH_PATHS.calendarMonth,
  ROUTES.more,
] as const;

/** Tab bar visible but not a main tab (no tab highlight). */
export const MOBILE_BOTTOM_TAB_BAR_EXTRA_PATHS = [
  ROUTES.dashboardAccount,
  BRANCH_PATHS.services,
] as const;

export type MobileBottomTabPath = (typeof MOBILE_BOTTOM_TAB_PATHS)[number];

/**
 * Full-screen flows that own the whole viewport: the tab bar (and the floating
 * header) would sit on top of their own chrome, so both are hidden. Everything
 * else under `/dashboard` keeps the tab bar — a mobile screen must always have
 * a way back out.
 */
const MOBILE_FULL_SCREEN_PREFIXES = [
  BRANCH_PATHS.calendarNew,
  // The unified editor: /create/:entity and /edit/:entity/:id. These are not
  // under /dashboard at all — one prefix covers every entity, present and
  // future, instead of a per-entity entry that a new editor could forget.
  '/create',
  '/edit',
  BRANCH_PATHS.advertisingNew,
  `${BRANCH_PATHS.socials}/new`,
  `${BRANCH_PATHS.contentGallery}/new`,
  BRANCH_PATHS.videosCreateFromClient,
] as const;

/**
 * Trailing slash off, and the `/l/:locationId` branch segment stripped.
 *
 * Every prefix in this file is written un-prefixed (`/dashboard/calendar/day`)
 * because the tab bar is the same on every branch. Normalising here — the one
 * function all three matchers already run their input through — is what makes
 * that true without touching a single prefix entry.
 */
export function normalizePathname(pathname: string): string {
  const withoutBranch = stripBranchFromPath(pathname);
  if (withoutBranch.length > 1 && withoutBranch.endsWith('/')) {
    return withoutBranch.slice(0, -1);
  }
  return withoutBranch;
}

export function getSearchParam(
  search: unknown,
  key: string
): string | undefined {
  if (search == null) {
    return undefined;
  }

  if (typeof search === 'string') {
    const trimmed = search.startsWith('?') ? search.slice(1) : search;
    return new URLSearchParams(trimmed).get(key) ?? undefined;
  }

  if (typeof search === 'object' && key in search) {
    const value = (search as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : undefined;
  }

  return undefined;
}

/** True when the route is a full-screen flow that hides the persistent chrome. */
export function isMobileFullScreenRoute(
  pathname: string,
  search?: unknown
): boolean {
  const path = normalizePathname(pathname);

  if (path === BRANCH_PATHS.conversations && getSearchParam(search, 'id')) {
    return true;
  }

  return MOBILE_FULL_SCREEN_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

function isDashboardPath(path: string): boolean {
  return path === ROUTES.dashboard || path.startsWith(`${ROUTES.dashboard}/`);
}

/**
 * True when the current route is one of the five main tab screens (drives the
 * tab highlight and the "root screen" mobile header, not tab-bar visibility).
 */
export function isMobileBottomTabRoute(
  pathname: string,
  search?: unknown
): boolean {
  const path = normalizePathname(pathname);

  if (!MOBILE_BOTTOM_TAB_PATHS.some((allowed) => allowed === path)) {
    return false;
  }

  return !isMobileFullScreenRoute(pathname, search);
}

/**
 * The tab bar is shown on every dashboard route except full-screen flows.
 * (It used to be an allow-list of seven paths, which stranded every other
 * mobile screen with no way back.)
 */
export function shouldShowMobileBottomTabBar(
  pathname: string,
  search?: unknown
): boolean {
  const path = normalizePathname(pathname);

  if (!isDashboardPath(path)) {
    return false;
  }

  return !isMobileFullScreenRoute(pathname, search);
}
