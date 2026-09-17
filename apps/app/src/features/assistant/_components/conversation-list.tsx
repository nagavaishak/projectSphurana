import { formatDistanceToNow } from 'date-fns';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useConversations,
  useDeleteConversation,
  useRenameConversation,
} from '@/features/assistant';
import type { ConversationSummary } from '@/features/assistant';
import { cn } from '@/lib/utils';

interface ConversationListProps {
  activeId?: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDeleteActive: () => void;
}

export function ConversationList({
  activeId,
  onSelect,
  onNewChat,
  onDeleteActive,
}: ConversationListProps) {
  const { conversations, isLoading } = useConversations();
  const [search, setSearch] = useState('');

  const filtered = conversations.filter((c) =>
    (c.title ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex h-full w-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-8 pb-4">
        <h1 className="text-2xl font-bold tracking-tight">Conversations</h1>
        <Button onClick={onNewChat} className="gap-2">
          New Chat
        </Button>
      </div>

      {/* Search */}
      <div className="px-6 pb-4">
        <Input
          placeholder="Search your chats..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-muted/50"
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-6">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-1.5 rounded-lg px-4 py-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {search
              ? 'No conversations match your search'
              : 'No conversations yet'}
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map((conversation) => (
              <ConversationItem
                key={conversation.id}
                conversation={conversation}
                isActive={conversation.id === activeId}
                onSelect={onSelect}
                onDeleteActive={onDeleteActive}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ConversationItemProps {
  conversation: ConversationSummary;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDeleteActive: () => void;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onDeleteActive,
}: ConversationItemProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const { renameConversation, isRenaming } = useRenameConversation();
  const { deleteConversation, isDeleting } = useDeleteConversation({
    onSuccess: () => {
      if (isActive) onDeleteActive();
    },
  });

  const openRename = () => {
    setRenameTitle(conversation.title ?? '');
    setRenameOpen(true);
  };

  const saveRename = () => {
    const trimmed = renameTitle.trim();
    if (trimmed && trimmed !== conversation.title) {
      renameConversation({ id: conversation.id, title: trimmed });
    }
    setRenameOpen(false);
  };

  useEffect(() => {
    if (renameOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [renameOpen]);

  return (
    <>
      <button
        type="button"
        onClick={() => onSelect(conversation.id)}
        className={cn(
          'group flex w-full items-start justify-between rounded-lg px-4 py-3 text-left transition-colors hover:bg-accent',
          isActive && 'bg-accent'
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-sm">
            {conversation.title || 'New conversation'}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Last message{' '}
            {formatDistanceToNow(new Date(conversation.updatedAt), {
              addSuffix: true,
            })}
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <span
              role="button"
              tabIndex={0}
              className="ml-2 inline-flex size-7 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-accent-foreground/10 group-hover:opacity-100 focus:opacity-100"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
              }}
            >
              <MoreHorizontal className="size-4" />
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                openRename();
              }}
            >
              <Pencil className="mr-2 size-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteOpen(true);
              }}
            >
              <Trash2 className="mr-2 size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </button>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
          </DialogHeader>
          <Input
            ref={inputRef}
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveRename();
              if (e.key === 'Escape') setRenameOpen(false);
            }}
            placeholder="Conversation name"
            maxLength={100}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveRename} disabled={isRenaming}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <ConfirmDeleteDialog
        description="The conversation and every message in it are permanently deleted. This action cannot be undone."
        isPending={isDeleting}
        onConfirm={() => deleteConversation(conversation.id)}
        onOpenChange={setDeleteOpen}
        open={deleteOpen}
        title={
          <>Delete &ldquo;{conversation.title || 'this conversation'}&rdquo;?</>
        }
      />
    </>
  );
}
