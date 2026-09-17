/** The literal segment that marks a branch-scoped path. See `$locationId.tsx`. */
const BRANCH_PREFIX = '/dashboard/l/';

/**
 * The branch HANDLE a pathname is scoped to, or `null` for an org-level path.
 *
 * "Handle", not "id", because the segment is a readable SLUG where the branch
 * has one (`/dashboard/l/dublin/calendar`) and falls back to the id where it
 * does not. `organization_location.slug` is unique but NULLABLE — a
 * single-location org never needs one — so a scheme that demanded slugs would
 * either 404 for most orgs or need a backfill nobody asked for. Accepting
 * either means readable URLs wherever a slug exists, and correct URLs
 * everywhere, with no migration.
 *
 * Pure and pathname-only on purpose: it has to answer for routes that are NOT
 * under the branch layout (`/dashboard/settings`, `/dashboard/locations`) where
 * there are no route params to read, and those pages still show the switcher.
 */
export function branchIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith(BRANCH_PREFIX)) return null;
  const rest = pathname.slice(BRANCH_PREFIX.length);
  const id = rest.split('/', 1)[0];
  return id.length > 0 ? id : null;
}

/**
 * Rewrite a branch-scoped path to point at a different branch, preserving the
 * sub-path — switching from Dublin to Cork while looking at the week calendar
 * lands on Cork's week calendar, not Cork's home.
 *
 * Returns `null` when the path is not branch-scoped, which the caller reads as
 * "nothing to navigate": switching branch from `/dashboard/settings` changes
 * which branch is remembered without moving the user off the settings page they
 * are in the middle of.
 */
export function swapBranchInPath(
  pathname: string,
  nextLocationId: string
): string | null {
  const current = branchIdFromPath(pathname);
  if (!current) return null;
  const suffix = pathname.slice(BRANCH_PREFIX.length + current.length);
  return `${BRANCH_PREFIX}${nextLocationId}${suffix}`;
}

/**
 * Build a branch-scoped path from a sub-path (`/calendar/day`).
 *
 * `handle` is the slug where the branch has one, else its id — use
 * `branchHandle()` to derive it rather than picking one here.
 */
export function branchPath(handle: string, subPath = ''): string {
  const normalised =
    subPath.length === 0 || subPath.startsWith('/') ? subPath : `/${subPath}`;
  return `${BRANCH_PREFIX}${handle}${normalised}`;
}

/**
 * Strip the branch prefix from a pathname, yielding the sub-path an org-level
 * matcher can compare against (`/dashboard/l/abc/calendar` → `/dashboard/calendar`).
 *
 * The sidebar's active-section matching runs on `/dashboard/…` prefixes, and
 * rewriting all of those to understand a variable id would spread the URL shape
 * across the nav config. Normalising once here keeps that knowledge in one file.
 */
export function stripBranchFromPath(pathname: string): string {
  const current = branchIdFromPath(pathname);
  if (!current) return pathname;
  const suffix = pathname.slice(BRANCH_PREFIX.length + current.length);
  return `/dashboard${suffix}`;
}

/**
 * The URL segment for a branch: its slug when it has one, else its id.
 *
 * One function so the choice is made in a single place. If half the app linked
 * by slug and half by id, the same branch would produce two different URLs —
 * both working, neither shareable as "the" link, and the active-branch
 * comparison in the switcher would miss.
 */
export function branchHandle(location: {
  id: string;
  slug?: string | null;
}): string {
  return location.slug ?? location.id;
}

/**
 * Find the branch a URL handle refers to, matching EITHER its slug or its id.
 *
 * Both are accepted for the whole life of a link, not just during a migration:
 * an id-form URL someone bookmarked before the branch was given a slug has to
 * keep working, and so does a slug-form URL after it is renamed — the id arm is
 * what catches the first, and the compatibility splat the second.
 */
export function findBranchByHandle<
  T extends { id: string; slug?: string | null },
>(locations: readonly T[], handle: string): T | undefined {
  return locations.find((l) => l.slug === handle || l.id === handle);
}
