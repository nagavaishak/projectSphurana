import type { MobileDashboardHeaderContent } from './mobile-dashboard-header-types';

export function areMobileDashboardHeaderContentsEqual(
  a: MobileDashboardHeaderContent,
  b: MobileDashboardHeaderContent
): boolean {
  if (
    a.heading !== b.heading ||
    a.subheading !== b.subheading ||
    a.showBack !== b.showBack ||
    a.centerTitle !== b.centerTitle ||
    a.compactTitle !== b.compactTitle ||
    a.alignItemsTop !== b.alignItemsTop ||
    a.extraActions !== b.extraActions ||
    a.hideInbox !== b.hideInbox ||
    a.hideNotifications !== b.hideNotifications ||
    a.hideTrailing !== b.hideTrailing ||
    a.onBack !== b.onBack ||
    a.centerSlot !== b.centerSlot ||
    a.leadingSlot !== b.leadingSlot ||
    a.titleSlot !== b.titleSlot ||
    a.rightSlot !== b.rightSlot
  ) {
    return false;
  }

  const aActions = a.rightActions;
  const bActions = b.rightActions;
  if (aActions === bActions) {
    return true;
  }
  if (!aActions || !bActions || aActions.length !== bActions.length) {
    return false;
  }
  return aActions.every((action, index) => action.id === bActions[index]?.id);
}
