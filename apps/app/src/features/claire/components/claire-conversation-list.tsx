import { MessageSquarePlus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type ConversationSummary,
  useConversations,
  useDeleteConversation,
} from '@/features/assistant';
import { cn } from '@/lib/utils';

/**
 * Conversation switcher. Currently unused — the v3 mini-panel
 * (`claire-chat-panel.tsx`) does not surface a thread switcher; users navigate
 * conversations on `/assistant`. Kept for a possible future iteration that
 * brings a switcher back to the mini-panel.
 */
interface ClaireConversationListProps {
  activeConversationId: string | null;
  onSelect: (id: string | null) => void;
  onNewChat: () => void;
}

export function ClaireConversationList({
  activeConversationId,
  onSelect,
  onNewChat,
}: ClaireConversationListProps) {
  const { conversations, isLoading, isError, error } = useConversations();
  const { deleteConversation, isDeleting } = useDeleteConversation();

  const handleDelete = (id: string) => {
    if (id === activeConversationId) onSelect(null);
    deleteConversation(id);
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b px-3 py-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={onNewChat}
        >
          <MessageSquarePlus className="size-4" />
          New chat
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && <ConversationListSkeleton />}

        {isError && (
          <p className="px-3 py-4 text-sm text-destructive">
            {error?.message ?? 'Failed to load conversations'}
          </p>
        )}

        {!isLoading && !isError && conversations.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            No conversations yet. Start a new chat to talk to Claire.
          </p>
        )}

        {!isLoading && conversations.length > 0 && (
          <ul className="space-y-0.5 p-2">
            {conversations.map((c) => (
              <ConversationRow
                key={c.id}
                conversation={c}
                isActive={c.id === activeConversationId}
                isDeleting={isDeleting}
                onSelect={() => onSelect(c.id)}
                onDelete={() => handleDelete(c.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface ConversationRowProps {
  conversation: ConversationSummary;
  isActive: boolean;
  isDeleting: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

function ConversationRow({
  conversation,
  isActive,
  isDeleting,
  onSelect,
  onDelete,
}: ConversationRowProps) {
  const title = conversation.title?.trim() || 'New chat';
  const isEscalated = conversation.status === 'escalated';

  return (
    <li>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors',
          isActive ? 'bg-accent' : 'hover:bg-accent/60'
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          className="flex flex-1 flex-col items-start gap-0.5 truncate text-left"
        >
          <span className="w-full truncate font-medium">{title}</span>
          {isEscalated && (
            <span className="text-xs text-muted-foreground">Escalated</span>
          )}
        </button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Delete conversation"
          disabled={isDeleting}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="size-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}

function ConversationListSkeleton() {
  return (
    <div className="space-y-1 p-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}
