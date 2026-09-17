import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { ConversationDetail } from '@/features/conversations/components/conversation-detail';
import { ConversationEmpty } from '@/features/conversations/components/conversation-empty';
import { ConversationsPanel } from '@/features/conversations/components/conversations-panel';
import { useMobileDashboardHeaderContent } from '@/features/mobile-dashboard-header';
import { useIsMobile } from '@/hooks/use-mobile';
import { useSession } from '@/lib/session';
import { useBranchRoutes } from '@/lib/use-routes';
import { useCallback, useMemo } from 'react';

const searchSchema = z.object({
  id: z.string().optional(),
});

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/clients/inbox'
)({
  validateSearch: searchSchema.parse,
  component: ConversationsPage,
});

function ConversationsPage() {
  const { id: selectedId } = Route.useSearch();
  const navigate = useNavigate();
  const routes = useBranchRoutes();
  const { data: session } = useSession();
  const isMobile = useIsMobile();

  const clearSelection = useCallback(
    () => navigate({ to: routes.clientsInbox, search: {} }),
    [navigate, routes]
  );

  const headerContent = useMemo(() => {
    if (!isMobile) {
      return {};
    }

    // NO close button, and no heading on the list.
    //
    // The inbox used to be a modal-ish destination reached from a chat bubble
    // in the header, so it carried an X back out to home. It is a bottom TAB
    // now: an X on a tab is a control with nowhere to go — the tab bar already
    // says where you are and how to leave — and it sat in the corner competing
    // with a 32px title crammed in beside the branch chip.
    //
    // The list's own title moved into the page, like every other screen. A
    // conversation still gets the back control, because that IS a drill-down.
    if (selectedId) {
      return {
        showBack: true,
        onBack: clearSelection,
      };
    }

    return {};
  }, [isMobile, selectedId, clearSelection]);

  useMobileDashboardHeaderContent(headerContent);

  return (
    <>
      <title>Conversations | Borradh</title>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {isMobile ? (
          selectedId ? (
            <ConversationDetail
              conversationId={selectedId}
              currentUserId={session?.user?.id}
              onBack={clearSelection}
              showInlineBackButton={false}
              onDeleted={clearSelection}
              variant="mobile"
            />
          ) : (
            <ConversationsPanel variant="mobile" />
          )
        ) : selectedId ? (
          <ConversationDetail
            conversationId={selectedId}
            currentUserId={session?.user?.id}
            onDeleted={clearSelection}
          />
        ) : (
          <ConversationEmpty />
        )}
      </div>
    </>
  );
}
