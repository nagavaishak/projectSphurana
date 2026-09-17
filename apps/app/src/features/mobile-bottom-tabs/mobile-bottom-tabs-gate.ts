import { shouldShowMobileBottomTabBar } from './mobile-bottom-tab-routes';

export function shouldShowMobileBottomTabs(
  isMobile: boolean,
  pathname: string,
  search?: unknown
): boolean {
  return isMobile && shouldShowMobileBottomTabBar(pathname, search);
}
