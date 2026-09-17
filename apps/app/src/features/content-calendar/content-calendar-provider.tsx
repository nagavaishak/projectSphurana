import { Link } from '@tanstack/react-router';
import { endOfMonth, endOfWeek, startOfMonth, startOfWeek } from 'date-fns';
import { CalendarIcon, LinkIcon, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  CONTENT_CONFIG,
  CalendarProvider,
  useCalendar,
} from '@/components/calendar';
import type { ICalendarConfig, IEvent, IUser } from '@/components/calendar';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useGetMetaIntegration,
  useListMetaAdsPages,
} from '@/features/integrations';
import type { MetaAdsPage } from '@/features/integrations';
import { useActiveOrganization } from '@/features/organization';
import {
  type SocialPost,
  isSocialPostEditable,
  useDeleteSocialPost,
  useListSocialPosts,
  useSyncSocialPosts,
  useUpdateSocialPost,
} from '@/features/social-posts';
import { AddContentDialog } from './add-content-dialog';
import { PostDetailsDialog } from './post-details-dialog';
import { RescheduleContentDialog } from './reschedule-content-dialog';

/**
 * Map social post status to calendar event color
 */
function getColorForStatus(status: SocialPost['status']): IEvent['color'] {
  switch (status) {
    case 'draft':
      return 'gray';
    case 'scheduled':
      return 'blue';
    case 'publishing':
      return 'yellow';
    case 'published':
      return 'green';
    case 'partial':
      return 'orange';
    case 'failed':
      return 'red';
    default:
      return 'blue';
  }
}

/**
 * Convert SocialPost (API) to IEvent (Calendar)
 */
function socialPostToEvent(post: SocialPost): IEvent {
  // Use scheduledAt or createdAt as the event time
  const eventDate = post.scheduledAt || post.createdAt;
  // Events are typically shown as 1-hour slots
  const startDate = new Date(eventDate);
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour duration

  return {
    id: post.id,
    title: post.title,
    description: post.caption || '',
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    color: getColorForStatus(post.status),
    user: {
      id: post.createdById,
      name: post.platforms.join(', '),
      picturePath: post.thumbnailUrl,
    },
    metadata: {
      mediaUrl: post.mediaUrl,
      mediaType: post.mediaType,
      thumbnailUrl: post.thumbnailUrl,
      status: post.status,
      platforms: post.platforms,
      publishedAt: post.publishedAt,
      errorMessage: post.errorMessage,
      platformResults: post.platformResults,
    },
  };
}

interface ContentCalendarProviderInnerProps {
  children: React.ReactNode;
}

/**
 * Sync button for the calendar header — triggers a manual Meta post sync.
 */
function SyncButton() {
  const { syncSocialPosts, isSyncing } = useSyncSocialPosts();

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={() => syncSocialPosts()}
      disabled={isSyncing}
      aria-label="Sync posts with Meta"
    >
      <RefreshCw className={isSyncing ? 'animate-spin' : ''} />
    </Button>
  );
}

/**
 * Inner component that syncs external data with CalendarProvider state.
 * Single source of truth for post data - fetches based on selected month.
 */
function ContentCalendarSyncWrapper({
  children,
}: ContentCalendarProviderInnerProps) {
  const { selectedDate, setLocalEvents } = useCalendar();

  // Auto-sync with Meta on mount (silent — only shows toast when posts were deleted)
  const hasSynced = useRef(false);
  const { syncSocialPosts } = useSyncSocialPosts({ silent: true });

  useEffect(() => {
    if (!hasSynced.current) {
      hasSynced.current = true;
      syncSocialPosts();
    }
  }, [syncSocialPosts]);

  // Calculate date range for fetching (extended to cover month view with week overlap)
  const dateRange = useMemo(() => {
    const monthStart = startOfMonth(selectedDate);
    const monthEnd = endOfMonth(selectedDate);
    return {
      start: startOfWeek(monthStart),
      end: endOfWeek(monthEnd),
    };
  }, [selectedDate]);

  // Fetch social posts for the date range
  const { posts } = useListSocialPosts({
    filters: {
      startDate: dateRange.start.toISOString(),
      endDate: dateRange.end.toISOString(),
      limit: 500,
    },
  });

  // Sync posts with calendar context when data changes (including empty months)
  // Use functional update to bail out when event IDs haven't changed,
  // preventing re-render loops from unstable array references.
  useEffect(() => {
    const events = posts.map(socialPostToEvent);
    setLocalEvents((prev) => {
      if (
        prev.length === events.length &&
        prev.every((e, i) => e.id === events[i]?.id)
      ) {
        return prev;
      }
      return events;
    });
  }, [posts, setLocalEvents]);

  return <>{children}</>;
}

interface PendingDrop {
  originalEvent: IEvent;
  updatedEvent: IEvent;
  resolve: (result: {
    confirmed: boolean;
    options?: Record<string, unknown>;
  }) => void;
}

interface ContentCalendarProviderProps {
  children: React.ReactNode;
}

/**
 * ContentCalendarProvider wraps children with CalendarProvider
 * configured for content mode with real API data
 */
export function ContentCalendarProvider({
  children,
}: ContentCalendarProviderProps) {
  const { data: organization, isLoading: isOrgLoading } =
    useActiveOrganization();
  const { isConnected, isLoading: isMetaLoading } = useGetMetaIntegration();
  const { pages, isLoading: isPagesLoading } = useListMetaAdsPages();

  // Mutations for update/delete (create uses custom dialog)
  const { updateSocialPostAsync } = useUpdateSocialPost();
  const { deleteSocialPostAsync } = useDeleteSocialPost();

  // Pending drop state for confirmation dialog
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);

  // Confirm drop handler — returns a Promise that resolves when the user makes a choice
  const handleConfirmDrop = useCallback(
    (params: { originalEvent: IEvent; updatedEvent: IEvent }) => {
      return new Promise<{
        confirmed: boolean;
        options?: Record<string, unknown>;
      }>((resolve) => {
        // The calendar is another update surface. Do not offer a reschedule
        // confirmation for the two server-immutable states.
        if (
          !isSocialPostEditable(
            params.originalEvent.metadata?.status as
              | SocialPost['status']
              | undefined
          )
        ) {
          resolve({ confirmed: false });
          return;
        }
        setPendingDrop({
          originalEvent: params.originalEvent,
          updatedEvent: params.updatedEvent,
          resolve,
        });
      });
    },
    []
  );

  // Update event callback (used by drag-drop)
  const handleUpdateEvent = useCallback(
    async (event: IEvent) => {
      // event.startDate is already an ISO instant (drag-drop). Caption
      // normalisation lives in the builder.
      await updateSocialPostAsync({
        id: String(event.id),
        title: event.title,
        caption: event.description ?? '',
        schedule: { at: event.startDate },
      });
    },
    [updateSocialPostAsync]
  );

  // Delete event callback
  const handleDeleteEvent = useCallback(
    async (event: IEvent) => {
      // The hook already surfaces failures (e.g. a 409 "currently publishing")
      // via a toast in its onError. Swallow the rejection here so it doesn't
      // bubble up as an unhandled promise rejection (ENG-256 / WEB-10).
      try {
        await deleteSocialPostAsync(String(event.id));
      } catch {
        // Already toasted by the mutation's onError — nothing more to do.
      }
    },
    [deleteSocialPostAsync]
  );

  // Dialog handlers
  const handleDialogCancel = useCallback(() => {
    pendingDrop?.resolve({ confirmed: false });
    setPendingDrop(null);
  }, [pendingDrop]);

  const handleDialogConfirm = useCallback(() => {
    pendingDrop?.resolve({ confirmed: true });
    setPendingDrop(null);
  }, [pendingDrop]);

  // Convert active Meta pages to calendar users for the UserSelect dropdown
  const users: IUser[] = useMemo(() => {
    return pages
      .filter((p: MetaAdsPage) => p.isActive)
      .map((p: MetaAdsPage) => ({
        id: p.id,
        name: p.pageName || p.pageUsername || p.platform,
        picturePath: p.pagePictureUrl,
      }));
  }, [pages]);

  // Build lookup: page ID → platform (e.g. 'facebook' | 'instagram')
  const pageIdToPlatform = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of pages) {
      map.set(p.id, p.platform);
    }
    return map;
  }, [pages]);

  // Custom event filter: match selected page's platform against post platforms
  const eventFilter = useCallback(
    (event: IEvent, selectedUserId: string) => {
      const platform = pageIdToPlatform.get(selectedUserId);
      if (!platform) return false;
      const platforms = event.metadata?.platforms;
      if (!Array.isArray(platforms)) return false;
      return platforms.includes(platform);
    },
    [pageIdToPlatform]
  );

  // Calendar config with custom add dialog and callbacks
  const config: Partial<ICalendarConfig> = useMemo(
    () => ({
      ...CONTENT_CONFIG,
      customAddDialog: AddContentDialog,
      customEventDetailsDialog: PostDetailsDialog,
      onConfirmDrop: handleConfirmDrop,
      onUpdateEvent: handleUpdateEvent,
      onDeleteEvent: handleDeleteEvent,
      eventFilter,
      // Reuse the Fresha-style toolbar + per-resource columns, with Meta pages
      // standing in for staff (matched to columns via `eventFilter` platform).
      dayColumnsPerStaff: true,
      resourceSelect: {
        allLabel: 'All pages',
        searchPlaceholder: 'Search pages',
        countNoun: 'pages',
      },
      headerActions: <SyncButton />,
      routerBasePath: '/dashboard/content-calendar',
    }),
    [handleConfirmDrop, handleUpdateEvent, handleDeleteEvent, eventFilter]
  );

  // Show loading state while checking prerequisites
  if (isOrgLoading || isMetaLoading || isPagesLoading) {
    return (
      <div className="flex h-full flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-10 w-48" />
          <div className="flex gap-2">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  // Show empty state if no Meta social account is connected
  if (!isConnected) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Empty className="max-w-md border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarIcon />
            </EmptyMedia>
            <EmptyTitle>Connect a social account</EmptyTitle>
            <EmptyDescription>
              To schedule and publish content, you need to connect your Facebook
              or Instagram account first.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link to="/dashboard/settings/integrations">
                <LinkIcon />
                Connect Account
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  return (
    <CalendarProvider
      users={users}
      events={[]}
      config={config}
      timeZone={organization?.timezone ?? 'UTC'}
    >
      <ContentCalendarSyncWrapper>{children}</ContentCalendarSyncWrapper>
      {pendingDrop && (
        <RescheduleContentDialog
          open={true}
          originalEvent={pendingDrop.originalEvent}
          updatedEvent={pendingDrop.updatedEvent}
          onCancel={handleDialogCancel}
          onConfirm={handleDialogConfirm}
        />
      )}
    </CalendarProvider>
  );
}
