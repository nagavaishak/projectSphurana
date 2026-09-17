import { stripBranchFromPath } from '@/features/organization-locations/branch-path';
import { BRANCH_PATHS, ROUTES } from '@/lib/route-paths';

/** Full-screen flows that own their chrome; hide the floating Claire launcher/panel. */
const CLAIRE_HIDDEN_PATH_PREFIXES = [
  ROUTES.adsNew,
  // Un-prefixed: the pathname is normalised below before comparing, so one
  // entry covers every branch.
  BRANCH_PATHS.calendarNew,
] as const;

/**
 * Hide Claire launcher + chat panel on focused create flows (ads, appointments).
 * Tours and recommendation toasts may still mount via {@link ClaireWidgetRoot}.
 */
export function isClaireHiddenOnPath(pathname: string): boolean {
  // Strip `/l/:locationId` first: these prefixes are branch-agnostic, and
  // teaching each of them about a variable id would spread the URL shape
  // across every matcher in the app.
  const normalised = stripBranchFromPath(pathname);
  const path =
    normalised.length > 1 && normalised.endsWith('/')
      ? normalised.slice(0, -1)
      : normalised;

  return CLAIRE_HIDDEN_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}
