import { normalizePathname } from '@/features/mobile-bottom-tabs/mobile-bottom-tab-routes';
import { ROUTES } from '@/lib/route-paths';

/**
 * Non-dashboard drill-downs that still render the mobile dashboard chrome.
 */
const MOBILE_HEADER_EXTRA_PREFIXES = [ROUTES.adsNew] as const;

function isDashboardPath(path: string): boolean {
  return path === ROUTES.dashboard || path.startsWith(`${ROUTES.dashboard}/`);
}

/**
 * Floating mobile header: every dashboard screen (tab roots and drill-downs
 * alike) plus the ad wizard. Pages tailor it — title, back button, extra
 * actions — through `useMobileDashboardHeaderContent`.
 */
export function shouldShowMobileDashboardHeader(
  isMobile: boolean,
  pathname: string,
  _search?: unknown
): boolean {
  if (!isMobile) {
    return false;
  }

  const path = normalizePathname(pathname);

  if (isDashboardPath(path)) {
    return true;
  }

  return MOBILE_HEADER_EXTRA_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}
