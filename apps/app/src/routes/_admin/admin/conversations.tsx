import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AdminOrgScope,
  OrgCombobox,
  type SelectedOrg,
  useGetOrganizationConversationStats,
} from '@/features/admin-terminal';
import { ConversationDetail } from '@/features/conversations/components/conversation-detail';
import { ConversationEmpty } from '@/features/conversations/components/conversation-empty';
import { ConversationsPanel } from '@/features/conversations/components/conversations-panel';
import { useSession } from '@/lib/session';

export const Route = createFileRoute('/_admin/admin/conversations')({
  component: AdminConversationsPage,
});

function StatCard({
  label,
  value,
  isLoading,
}: {
  label: string;
  value: number | undefined;
  isLoading: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        {isLoading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <CardTitle className="text-3xl tabular-nums">{value ?? 0}</CardTitle>
        )}
      </CardHeader>
    </Card>
  );
}

function ConversationStats({ organizationId }: { organizationId: string }) {
  const { stats, isLoading } =
    useGetOrganizationConversationStats(organizationId);
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard label="Today" value={stats?.today} isLoading={isLoading} />
      <StatCard
        label="Past 7 days"
        value={stats?.last7Days}
        isLoading={isLoading}
      />
      <StatCard label="Total" value={stats?.total} isLoading={isLoading} />
    </div>
  );
}

/**
 * Inbox for the selected org, rendered under `AdminOrgScope` so all
 * conversation queries resolve that org (via the admin override header) with an
 * isolated cache. Selection is local state, not the route.
 */
function AdminInbox({ organizationId }: { organizationId: string }) {
  const { data: session } = useSession();
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  return (
    <div className="flex flex-col gap-4">
      <ConversationStats organizationId={organizationId} />
      <div className="flex min-h-[600px] overflow-hidden rounded-lg border">
        <div className="bg-sidebar text-sidebar-foreground hidden w-[320px] shrink-0 flex-col overflow-y-auto border-r md:flex">
          <ConversationsPanel
            selectedId={selectedId}
            onSelectConversation={setSelectedId}
            autoSync={false}
          />
        </div>
        <div className="min-w-0 flex-1">
          {selectedId ? (
            <ConversationDetail
              conversationId={selectedId}
              currentUserId={session?.user?.id}
              showInlineBackButton={false}
              onDeleted={() => setSelectedId(undefined)}
            />
          ) : (
            <ConversationEmpty />
          )}
        </div>
      </div>
    </div>
  );
}

function AdminConversationsPage() {
  const [org, setOrg] = useState<SelectedOrg | null>(null);

  return (
    <div className="container max-w-7xl py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Conversations</h1>
        <p className="text-muted-foreground">
          Inspect any organization&apos;s inbox.
        </p>
      </div>

      <div className="mb-6">
        <OrgCombobox value={org} onChange={setOrg} />
      </div>

      {org ? (
        <AdminOrgScope organizationId={org.id}>
          <AdminInbox organizationId={org.id} />
        </AdminOrgScope>
      ) : (
        <p className="text-muted-foreground text-sm">
          Select an organization to view its conversations.
        </p>
      )}
    </div>
  );
}
