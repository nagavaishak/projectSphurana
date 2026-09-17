import { MobilePageShell } from '@/components/app/mobile-page-shell';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInput,
} from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  conversationStatusLabels,
  conversationStatusValues,
  messagingPlatformLabels,
  messagingPlatformValues,
  useListConversations,
  useSyncConversations,
} from '@/features/conversations/api';
import type {
  ConversationListItem,
  ConversationStatus,
  MessagingPlatform,
} from '@/features/conversations/api';
import {
  useActiveOrganization,
  useGetOrganizationMembers,
} from '@/features/organization';
import { cn } from '@/lib/utils';
import { useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ConversationInboxRow } from './conversation-inbox-row';
import {
  ConversationsInboxEmpty,
  hasActiveInboxFilters,
} from './conversations-inbox-empty';
import {
  ConversationsInboxFilters,
  type HandledByFilterValue,
} from './conversations-inbox-filters';
import { DaySeparatorBadge, dayKey, formatDayLabel } from './day-separator';
import { formatOrganizationMemberRoleLabel } from './handled-by-filter-dropdown';

function memberFirstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function useConversationsInboxState(autoSync: boolean) {
  const idFromSearch = useRouterState({
    select: (s) => {
      if (!s.location.pathname.includes('/dashboard/clients/inbox')) {
        return undefined;
      }
      const raw = s.location.search as string | Record<string, unknown>;
      if (typeof raw === 'string') {
        const trimmed = raw.startsWith('?') ? raw.slice(1) : raw;
        return new URLSearchParams(trimmed).get('id') ?? undefined;
      }
      if (raw && typeof raw === 'object' && 'id' in raw) {
        const id = (raw as { id?: string }).id;
        return typeof id === 'string' ? id : undefined;
      }
      return undefined;
    },
  });

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [handledByFilter, setHandledByFilter] =
    useState<HandledByFilterValue>('all');

  const { data: activeOrg } = useActiveOrganization();
  const { members } = useGetOrganizationMembers(activeOrg?.id ?? '');

  const memberFirstNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      map.set(member.user.id, memberFirstName(member.user.name));
    }
    return map;
  }, [members]);

  const agentOptions = useMemo(
    () =>
      members.map((m) => ({
        id: m.user.id,
        firstName: memberFirstName(m.user.name),
        fullName: m.user.name,
        image: m.user.image,
        roleLabel: formatOrganizationMemberRoleLabel(m.role),
      })),
    [members]
  );

  const apiStatus: ConversationStatus | undefined =
    handledByFilter === 'claire_ai'
      ? 'bot_handling'
      : handledByFilter.startsWith('agent:')
        ? 'agent_handling'
        : handledByFilter === 'unassigned'
          ? undefined
          : statusFilter !== 'all'
            ? (statusFilter as ConversationStatus)
            : undefined;

  const {
    conversations: apiConversations,
    isLoading,
    isError,
  } = useListConversations({
    status: apiStatus,
    limit: 100,
    offset: 0,
  });

  const conversations = apiConversations;

  const { syncConversations } = useSyncConversations();
  const hasSynced = useRef(false);
  useEffect(() => {
    // Admin org-override views are read-only, so the sync POST would be
    // rejected — skip it. The org's owners trigger syncs from their own session.
    if (!autoSync) return;
    if (!hasSynced.current) {
      hasSynced.current = true;
      syncConversations();
    }
  }, [autoSync, syncConversations]);

  const filtered = useMemo(() => {
    let items = conversations;

    if (platformFilter !== 'all') {
      items = items.filter((c) => c.platform === platformFilter);
    }

    if (handledByFilter === 'claire_ai') {
      items = items.filter((c) => c.status === 'bot_handling');
    } else if (handledByFilter === 'unassigned') {
      items = items.filter(
        (c) => !c.assignedToId && c.status !== 'bot_handling'
      );
    } else if (handledByFilter.startsWith('agent:')) {
      const userId = handledByFilter.slice('agent:'.length);
      items = items.filter((c) => c.assignedToId === userId);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (c) =>
          c.externalUserName?.toLowerCase().includes(q) ||
          c.externalUserId.toLowerCase().includes(q) ||
          c.lastMessageContent?.toLowerCase().includes(q)
      );
    }

    return items;
  }, [conversations, search, platformFilter, handledByFilter]);

  return {
    idFromSearch,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    platformFilter,
    setPlatformFilter,
    handledByFilter,
    setHandledByFilter,
    agentOptions,
    memberFirstNameById,
    filtered,
    isLoading,
    isError,
  };
}

function ConversationListBody({
  conversations,
  isLoading,
  isError,
  selectedId,
  memberFirstNameById,
  variant,
  hasActiveFilters,
  onClearFilters,
  onSelectConversation,
}: {
  conversations: ConversationListItem[];
  isLoading: boolean;
  isError: boolean;
  selectedId?: string;
  memberFirstNameById: Map<string, string>;
  variant: 'sidebar' | 'mobile';
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  onSelectConversation?: (id: string) => void;
}) {
  if (isLoading) {
    return (
      <div
        className={cn(
          'flex flex-col gap-2',
          variant === 'mobile' ? 'p-4' : 'p-3'
        )}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[72px] w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-4 text-center text-sm text-destructive">
        Failed to load conversations.
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <ConversationsInboxEmpty
        variant={variant}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={onClearFilters}
      />
    );
  }

  const rows: ReactNode[] = [];
  let prevDay: string | null = null;
  for (const conv of conversations) {
    const dateIso = conv.lastMessageAt ?? conv.createdAt;
    const day = dayKey(dateIso);
    if (day !== prevDay) {
      prevDay = day;
      rows.push(
        <DaySeparatorBadge
          key={`day-${day}-${rows.length}`}
          label={formatDayLabel(new Date(dateIso))}
        />
      );
    }
    rows.push(
      <ConversationInboxRow
        key={conv.id}
        conversation={conv}
        isSelected={selectedId === conv.id}
        memberFirstNameById={memberFirstNameById}
        variant={variant}
        onSelect={onSelectConversation}
      />
    );
  }

  return (
    <div
      className={cn(variant === 'sidebar' && 'flex flex-col gap-2 p-3 pt-2')}
    >
      {rows}
    </div>
  );
}

export function ConversationsPanel({
  selectedId,
  variant = 'sidebar',
  onSelectConversation,
  autoSync = true,
}: {
  selectedId?: string;
  variant?: 'sidebar' | 'mobile';
  /**
   * When provided, rows call this instead of navigating to
   * `/dashboard/conversations` — used by the admin panel for local selection.
   */
  onSelectConversation?: (id: string) => void;
  /**
   * Auto-trigger a conversation sync on mount. Disabled in the admin
   * (read-only) view, where the sync POST would be rejected.
   */
  autoSync?: boolean;
}) {
  const {
    idFromSearch,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    platformFilter,
    setPlatformFilter,
    handledByFilter,
    setHandledByFilter,
    agentOptions,
    memberFirstNameById,
    filtered,
    isLoading,
    isError,
  } = useConversationsInboxState(autoSync);

  const effectiveSelectedId = selectedId ?? idFromSearch;
  const isMobile = variant === 'mobile';

  const inboxFiltersActive = hasActiveInboxFilters({
    search,
    platformFilter,
    handledByFilter,
    statusFilter,
  });

  const clearInboxFilters = () => {
    setSearch('');
    setPlatformFilter('all');
    setHandledByFilter('all');
    setStatusFilter('all');
  };

  if (isMobile) {
    return (
      <MobilePageShell
        className="bg-white"
        tabRoot
        title="Messages"
        toolbar={
          <ConversationsInboxFilters
            agentOptions={agentOptions}
            handledByFilter={handledByFilter}
            onHandledByFilterChange={setHandledByFilter}
            onPlatformFilterChange={setPlatformFilter}
            onSearchChange={setSearch}
            platformFilter={platformFilter}
            search={search}
          />
        }
      >
        <ConversationListBody
          conversations={filtered}
          hasActiveFilters={inboxFiltersActive}
          isError={isError}
          isLoading={isLoading}
          memberFirstNameById={memberFirstNameById}
          onClearFilters={clearInboxFilters}
          onSelectConversation={onSelectConversation}
          selectedId={effectiveSelectedId}
          variant="mobile"
        />
      </MobilePageShell>
    );
  }

  return (
    <>
      <SidebarHeader className="gap-3.5 border-b p-4">
        <div className="text-base font-medium text-foreground">
          Conversations
        </div>
        <SidebarInput
          placeholder="Search conversations..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-7 flex-1 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {conversationStatusValues.map((s) => (
                <SelectItem key={s} value={s}>
                  {conversationStatusLabels[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={platformFilter} onValueChange={setPlatformFilter}>
            <SelectTrigger className="h-7 flex-1 text-xs">
              <SelectValue placeholder="Platform" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Platforms</SelectItem>
              {messagingPlatformValues.map((p) => (
                <SelectItem key={p} value={p}>
                  {messagingPlatformLabels[p as MessagingPlatform]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="px-0">
          <SidebarGroupContent>
            <ConversationListBody
              conversations={filtered}
              isLoading={isLoading}
              isError={isError}
              selectedId={effectiveSelectedId}
              memberFirstNameById={memberFirstNameById}
              variant="sidebar"
              hasActiveFilters={inboxFiltersActive}
              onClearFilters={clearInboxFilters}
              onSelectConversation={onSelectConversation}
            />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </>
  );
}
