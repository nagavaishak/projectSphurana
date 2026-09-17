import type {
  Notification,
  NotificationType,
} from '@borradh-workspace/api-client/types';
import { useNavigate } from '@tanstack/react-router';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CalendarX,
  type LucideIcon,
  MegaphoneOff,
  MessageCircle,
  ShoppingBag,
  UserPlus,
} from 'lucide-react';

import { cn } from '@/lib/utils';

interface NotificationItemProps {
  notification: Notification;
  /** Marks the notification as read. */
  onMarkRead: (id: string) => void;
  /** Called after navigation so the panel can close itself. */
  onClose: () => void;
}

/** Maps a notification type to its lucide icon. */
const typeIcons: Record<NotificationType, LucideIcon> = {
  appointment_booked: CalendarClock,
  appointment_rescheduled: CalendarClock,
  appointment_cancelled: CalendarX,
  chatbot_handoff: MessageCircle,
  ad_rejected: MegaphoneOff,
  lead_created: UserPlus,
  shop_order_received: ShoppingBag,
};

function getTypeIcon(type: string): LucideIcon {
  return typeIcons[type as NotificationType] ?? Bell;
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return formatDistanceToNow(date, { addSuffix: true });
}

/**
 * A single row in the notification feed. The whole row is a button: clicking it
 * marks the notification read and, when a `linkPath` is set, navigates there and
 * closes the panel.
 */
export function NotificationItem({
  notification,
  onMarkRead,
  onClose,
}: NotificationItemProps) {
  const navigate = useNavigate();
  const isUnread = notification.readAt === null;
  const Icon =
    notification.type === 'ad_rejected'
      ? AlertTriangle
      : getTypeIcon(notification.type);
  const relativeTime = formatRelativeTime(notification.createdAt);

  const handleClick = () => {
    if (isUnread) {
      onMarkRead(notification.id);
    }
    if (notification.linkPath) {
      navigate({ to: notification.linkPath });
      onClose();
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-md px-3 py-3 text-left transition-colors',
        'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
        isUnread && 'bg-accent/40'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
          isUnread
            ? 'bg-primary/10 text-primary'
            : 'bg-muted text-muted-foreground'
        )}
      >
        <Icon className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              'truncate text-sm font-semibold',
              !isUnread && 'text-foreground'
            )}
          >
            {notification.title}
          </p>
          {isUnread ? (
            <span
              aria-label="Unread"
              className="mt-1.5 block size-2 shrink-0 rounded-full bg-red-500"
            />
          ) : null}
        </div>
        {notification.body ? (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {notification.body}
          </p>
        ) : null}
        {relativeTime ? (
          <p className="mt-1 text-xs text-muted-foreground">{relativeTime}</p>
        ) : null}
      </div>
    </button>
  );
}
