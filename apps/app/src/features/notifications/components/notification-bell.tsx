import { Bell } from 'lucide-react';
import { useState } from 'react';

import { MobileBottomSheet } from '@/components/mobile-bottom-sheet';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useGetUnreadNotificationCount } from '@/features/notifications';
import { useIsMobile } from '@/hooks/use-mobile';

import { NotificationsPanel } from './notifications-panel';

/**
 * The notification bell trigger rendered in the site header. Shows an unread
 * dot when there are unread notifications. Opens a popover on desktop and a
 * bottom sheet on mobile, both containing the shared notifications panel.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const { unreadCount } = useGetUnreadNotificationCount();
  const hasUnread = unreadCount > 0;

  const ariaLabel = hasUnread
    ? `Notifications (${unreadCount} unread)`
    : 'Notifications';

  const renderTriggerButton = (props?: { onClick?: () => void }) => (
    <Button
      variant="ghost"
      size="icon"
      className="relative rounded-full"
      aria-label={ariaLabel}
      onClick={props?.onClick}
    >
      <Bell className="size-5" />
      {hasUnread ? (
        <span
          aria-hidden
          className="absolute bottom-1.5 right-1.5 block size-2 rounded-full bg-red-500 ring-2 ring-background"
        />
      ) : null}
    </Button>
  );

  if (isMobile) {
    return (
      <>
        {renderTriggerButton({ onClick: () => setOpen(true) })}
        <MobileBottomSheet
          open={open}
          onOpenChange={setOpen}
          title="Notifications"
          contentBased
        >
          <NotificationsPanel onClose={() => setOpen(false)} />
        </MobileBottomSheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{renderTriggerButton()}</PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0">
        <NotificationsPanel onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
