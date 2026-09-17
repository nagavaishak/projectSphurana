import { BellOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useListNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
} from '@/features/notifications';

import { NotificationItem } from './notification-item';

interface NotificationsPanelProps {
  /**
   * Called when a notification with a link is opened, to dismiss the panel.
   * Optional: on the notifications PAGE there is no container to dismiss — the
   * link navigation is the whole action.
   */
  onClose?: () => void;
}

const noop = () => {};

function PanelSkeleton() {
  return (
    <div className="space-y-1 p-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-start gap-3 px-3 py-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The notification feed body — a header with a "Mark all read" action, a
 * scrollable list of feed rows, and loading / error / empty states. Used inside
 * both the desktop popover and the mobile bottom sheet.
 */
export function NotificationsPanel({ onClose }: NotificationsPanelProps = {}) {
  const { notifications, isLoading, isError, refetch } = useListNotifications({
    limit: 30,
  });
  const { markRead } = useMarkNotificationRead();
  const { markAllRead, isMarking } = useMarkAllNotificationsRead();

  const hasUnread = notifications.some((n) => n.readAt === null);

  return (
    <div className="flex max-h-[70vh] min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Notifications</h2>
        {hasUnread ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            disabled={isMarking}
            onClick={() => markAllRead()}
          >
            {isMarking ? 'Marking...' : 'Mark all read'}
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? <PanelSkeleton /> : null}

        {!isLoading && isError ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Couldn't load notifications.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        ) : null}

        {!isLoading && !isError && notifications.length === 0 ? (
          <Empty className="border-0 py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BellOff />
              </EmptyMedia>
              <EmptyTitle>You're all caught up</EmptyTitle>
              <EmptyDescription>
                New bookings, handoffs and ad updates will show up here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {!isLoading && !isError && notifications.length > 0 ? (
          <div className="space-y-1 p-2">
            {notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onMarkRead={markRead}
                onClose={onClose ?? noop}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
