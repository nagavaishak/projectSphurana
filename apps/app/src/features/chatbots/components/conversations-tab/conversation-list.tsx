import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  conversationStatusLabels,
  conversationStatusValues,
  messagingPlatformLabels,
  useListConversations,
} from '@/features/conversations/api';
import type { ConversationStatus } from '@/features/conversations/api';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';

interface ConversationListProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ConversationList({
  selectedId,
  onSelect,
}: ConversationListProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const { conversations, isLoading, isError } = useListConversations({
    status:
      statusFilter !== 'all' ? (statusFilter as ConversationStatus) : undefined,
    limit: 100,
    offset: 0,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.toLowerCase();
    return conversations.filter(
      (c) =>
        c.externalUserName?.toLowerCase().includes(q) ||
        c.externalUserId.toLowerCase().includes(q)
    );
  }, [conversations, search]);

  const statusVariant: Record<
    string,
    'default' | 'secondary' | 'destructive' | 'outline'
  > = {
    active: 'default',
    bot_handling: 'secondary',
    agent_handling: 'default',
    closed: 'outline',
    expired: 'destructive',
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
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

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Conversations</SelectItem>
            {conversationStatusValues.map((s) => (
              <SelectItem key={s} value={s}>
                {conversationStatusLabels[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ScrollArea className="flex-1">
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No conversations found.
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <button
                key={conv.id}
                type="button"
                onClick={() => onSelect(conv.id)}
                className={cn(
                  'flex items-start gap-3 border-b px-3 py-3 text-left transition-colors hover:bg-muted/50',
                  selectedId === conv.id && 'bg-muted'
                )}
              >
                <Avatar className="size-9 shrink-0">
                  {conv.externalUserAvatar && (
                    <AvatarImage src={conv.externalUserAvatar} />
                  )}
                  <AvatarFallback className="text-xs">
                    {(conv.externalUserName ?? conv.externalUserId)
                      .charAt(0)
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {conv.externalUserName ?? conv.externalUserId}
                    </span>
                    {conv.lastMessageAt && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(conv.lastMessageAt), {
                          addSuffix: true,
                        })}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <Badge
                      variant={statusVariant[conv.status] ?? 'outline'}
                      className="text-[10px] px-1.5 py-0"
                    >
                      {conversationStatusLabels[conv.status]}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {messagingPlatformLabels[conv.platform]}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
