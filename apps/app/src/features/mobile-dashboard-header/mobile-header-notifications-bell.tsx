import { MobileBottomSheet } from '@/components/mobile-bottom-sheet';
import {
  NotificationsPanel,
  useGetUnreadNotificationCount,
} from '@/features/notifications';
import { Bell } from 'lucide-react';
import { useState } from 'react';

import { MobileHeaderIconButton } from './mobile-header-icon-button';

export interface MobileHeaderNotificationsBellProps {
  /**
   * Override the default behaviour (opening the notifications sheet). When set,
   * the in-place bottom sheet is not rendered — the caller owns the action.
   */
  onClick?: () => void;
  /**
   * Force the unread indicator on. When omitted, the live unread count drives
   * the badge.
   */
  hasUnread?: boolean;
}

/**
 * Notifications bell for the mobile dashboard header. Tapping it opens the
 * shared notifications panel in a bottom sheet. Shared by the default header
 * actions and any custom `rightSlot` (home, socials, …) that still wants the
 * bell alongside its own controls.
 */
export function MobileHeaderNotificationsBell({
  onClick,
  hasUnread,
}: MobileHeaderNotificationsBellProps) {
  const { unreadCount } = useGetUnreadNotificationCount();
  const [open, setOpen] = useState(false);
  const showUnread = Boolean(hasUnread) || unreadCount > 0;

  return (
    <>
      <MobileHeaderIconButton
        aria-label="Notifications"
        className="relative"
        onClick={onClick ?? (() => setOpen(true))}
      >
        <Bell className="size-5 text-[#525252]" strokeWidth={2} />
        {showUnread ? (
          <span
            className="absolute right-2.5 bottom-2.5 size-2 rounded-full bg-[#FF3B30] ring-2 ring-white"
            aria-hidden
          />
        ) : null}
      </MobileHeaderIconButton>
      {!onClick ? (
        <MobileBottomSheet
          open={open}
          onOpenChange={setOpen}
          title="Notifications"
          contentBased
        >
          <NotificationsPanel onClose={() => setOpen(false)} />
        </MobileBottomSheet>
      ) : null}
    </>
  );
}
