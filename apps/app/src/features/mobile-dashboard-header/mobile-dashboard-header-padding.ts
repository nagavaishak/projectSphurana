import { useRouterState } from '@tanstack/react-router';

import {
  getSearchParam,
  normalizePathname,
} from '@/features/mobile-bottom-tabs/mobile-bottom-tab-routes';
import { useIsMobile } from '@/hooks/use-mobile';
import { BRANCH_PATHS } from '@/lib/route-paths';

import { shouldShowMobileDashboardHeader } from './mobile-dashboard-header-gate';
import {
  MOBILE_DASHBOARD_HEADER_CLEARANCE_CLASS,
  MOBILE_DASHBOARD_HEADER_TALL_CLEARANCE_CLASS,
} from './mobile-dashboard-header-layout';

export {
  MOBILE_DASHBOARD_HEADER_CLEARANCE_CLASS,
  MOBILE_DASHBOARD_HEADER_TALL_CLEARANCE_CLASS,
} from './mobile-dashboard-header-layout';

export function useMobileDashboardHeaderClearanceClass(): string | undefined {
  const isMobile = useIsMobile();
  const { pathname, search } = useRouterState({
    select: (s) => ({
      pathname: s.location.pathname,
      search: s.location.search,
    }),
  });

  if (!shouldShowMobileDashboardHeader(isMobile, pathname, search)) {
    return undefined;
  }

  const path = normalizePathname(pathname);
  if (path === BRANCH_PATHS.conversations && getSearchParam(search, 'id')) {
    return MOBILE_DASHBOARD_HEADER_TALL_CLEARANCE_CLASS;
  }

  return MOBILE_DASHBOARD_HEADER_CLEARANCE_CLASS;
}
