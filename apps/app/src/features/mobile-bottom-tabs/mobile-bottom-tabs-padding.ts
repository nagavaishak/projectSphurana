import { useRouterState } from '@tanstack/react-router';

import { useIsMobile } from '@/hooks/use-mobile';

import { shouldShowMobileBottomTabs } from './mobile-bottom-tabs-gate';
import { MOBILE_TAB_BAR_CLEARANCE_CLASS } from './mobile-bottom-tabs-layout';

export { MOBILE_TAB_BAR_CLEARANCE_CLASS } from './mobile-bottom-tabs-layout';

export function useMobileBottomTabBarClearanceClass(): string | undefined {
  const isMobile = useIsMobile();
  const { pathname, search } = useRouterState({
    select: (s) => ({
      pathname: s.location.pathname,
      search: s.location.search,
    }),
  });
  return shouldShowMobileBottomTabs(isMobile, pathname, search)
    ? MOBILE_TAB_BAR_CLEARANCE_CLASS
    : undefined;
}
