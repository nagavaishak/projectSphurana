import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  conversationStatusLabels,
  useAssignConversation,
  useCloseConversation,
  useDeleteConversation,
  useGetConversation,
  useListMessages,
  useSendMessage,
} from '@/features/conversations/api';
import type { Conversation } from '@/features/conversations/api';
import { cn } from '@/lib/utils';
import { ArrowLeft, Send, Trash2, UserCheck, XCircle } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { useSidePanel } from '@/components/app/side-panel';
import { LeadDetailPanel } from '@/features/leads';
import {
  useActiveOrganization,
  useGetOrganizationMembers,
} from '@/features/organization';

import { AdReferralCard } from './ad-referral-card';
import { ConversationMobileDetail } from './conversation-mobile-detail';
import { DaySeparatorBadge, dayKey, formatDayLabel } from './day-separator';
import { MessageBubble } from './message-bubble';
import { PlatformBadge } from './platform-badge';

function memberFirstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function ConversationHeader({
  conversation,
  currentUserId,
  onDeleted,
  onBack,
  showInlineBackButton = true,
}: {
  conversation: Conversation;
  currentUserId?: string;
  onDeleted?: () => void;
  onBack?: () => void;
  showInlineBackButton?: boolean;
}) {
  const { closeConversation, isClosing } = useCloseConversation();
  const { assignConversation, isAssigning } = useAssignConversation();
  const { deleteConversation, isDeleting } = useDeleteConversation({
    onSuccess: onDeleted,
  });
  const { open: openPanel } = useSidePanel();

  const isOpen =
    conversation.status !== 'closed' && conversation.status !== 'expired';
  const isAssignedToMe = conversation.assignedToId === currentUserId;
  const displayName =
    conversation.externalUserName ?? conversation.externalUserId;
  const leadId = conversation.metadata?.leadId;

  // Avatar + name + platform cluster. When the conversation is linked to a
  // lead, the whole cluster becomes a hover-shaded hit area that opens the
  // lead's detail panel on the right — not a button-looking control.
  const identityContent = (
    <>
      <Avatar className="size-8 shrink-0">
        {conversation.externalUserAvatar && (
          <AvatarImage src={conversation.externalUserAvatar} />
        )}
        <AvatarFallback className="text-xs">
          {displayName.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 text-left">
        <p className="truncate text-sm font-medium">{displayName}</p>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {conversationStatusLabels[conversation.status]}
          </Badge>
          <PlatformBadge platform={conversation.platform} />
        </div>
      </div>
    </>
  );

  return (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {onBack && showInlineBackButton ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 rounded-full"
            aria-label="Back to conversations"
            onClick={onBack}
          >
            <ArrowLeft className="size-5" />
          </Button>
        ) : null}
        {leadId ? (
          <button
            type="button"
            onClick={() => openPanel(<LeadDetailPanel leadId={leadId} />)}
            title="View lead"
            className="-mx-2 flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-muted cursor-pointer"
          >
            {identityContent}
          </button>
        ) : (
          <div className="flex min-w-0 items-center gap-3">
            {identityContent}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {isOpen && (
          <>
            {!isAssignedToMe && currentUserId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  assignConversation({
                    id: conversation.id,
                    assignToUserId: currentUserId,
                  })
                }
                disabled={isAssigning}
              >
                <UserCheck className="mr-1.5 size-3.5" />
                {isAssigning ? 'Assigning...' : 'Take Over'}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => closeConversation(conversation.id)}
              disabled={isClosing}
            >
              <XCircle className="mr-1.5 size-3.5" />
              {isClosing ? 'Closing...' : 'Close'}
            </Button>
          </>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => deleteConversation(conversation.id)}
          disabled={isDeleting}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="mr-1.5 size-3.5" />
          {isDeleting ? 'Deleting...' : 'Delete'}
        </Button>
      </div>
    </div>
  );
}

function MobileConversationView({
  conversation,
  conversationId,
  memberFirstNameById,
  memberFullNameById,
  memberImageById,
  composerDisabled,
  onBack,
}: {
  conversation: Conversation;
  conversationId: string;
  memberFirstNameById: Map<string, string>;
  memberFullNameById: Map<string, string>;
  memberImageById: Map<string, string | null>;
  composerDisabled: boolean;
  onBack?: () => void;
}) {
  const { messages, isLoading } = useListMessages(conversationId, {
    limit: 100,
  });
  const { sendMessage, isSending } = useSendMessage();

  return (
    <ConversationMobileDetail
      conversation={conversation}
      messages={messages}
      memberFirstNameById={memberFirstNameById}
      memberFullNameById={memberFullNameById}
      memberImageById={memberImageById}
      isLoadingMessages={isLoading}
      composerDisabled={composerDisabled}
      isSending={isSending}
      onSend={(content) => sendMessage({ conversationId, content })}
      onBack={onBack}
    />
  );
}

function MessageThread({
  conversationId,
  conversation,
}: {
  conversationId: string;
  conversation: Conversation;
}) {
  const { messages, isLoading } = useListMessages(conversationId, {
    limit: 100,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton
            key={i}
            className={cn('h-12 w-2/3', i % 2 === 1 && 'ml-auto')}
          />
        ))}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col p-4">
        <AdReferralCard metadata={conversation.metadata} />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">
            No messages yet in this conversation.
          </p>
        </div>
      </div>
    );
  }

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent className="gap-3 p-4">
            <MessageScrollerItem>
              <AdReferralCard metadata={conversation.metadata} />
            </MessageScrollerItem>
            {messages.map((msg, index) => {
              const iso = msg.sentAt ?? msg.createdAt;
              const prev = index > 0 ? messages[index - 1] : null;
              const prevIso = prev ? (prev.sentAt ?? prev.createdAt) : null;
              const showDayBadge = !prevIso || dayKey(prevIso) !== dayKey(iso);
              return (
                <MessageScrollerItem
                  key={msg.id}
                  messageId={msg.id}
                  scrollAnchor={msg.role === 'user'}
                  className="flex flex-col gap-3"
                >
                  {showDayBadge ? (
                    <DaySeparatorBadge label={formatDayLabel(new Date(iso))} />
                  ) : null}
                  <MessageBubble message={msg} />
                </MessageScrollerItem>
              );
            })}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

function MessageInput({
  conversationId,
  disabled,
}: {
  conversationId: string;
  disabled: boolean;
}) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { sendMessage, isSending } = useSendMessage({
    onSuccess: () => {
      setText('');
      textareaRef.current?.focus();
    },
  });

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;

    sendMessage({ conversationId, content: trimmed });
  }, [text, isSending, conversationId, sendMessage]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t p-3">
      {disabled ? (
        <p className="text-center text-sm text-muted-foreground">
          This conversation is closed.
        </p>
      ) : (
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={3}
            className="min-h-[80px] max-h-[200px] resize-none"
            disabled={isSending}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!text.trim() || isSending}
          >
            <Send className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

interface ConversationDetailProps {
  conversationId: string;
  currentUserId?: string;
  onDeleted?: () => void;
  onBack?: () => void;
  /** When false, back is handled by the mobile dashboard header instead. */
  showInlineBackButton?: boolean;
  variant?: 'sidebar' | 'mobile';
}

export function ConversationDetail({
  conversationId,
  currentUserId,
  onDeleted,
  onBack,
  showInlineBackButton = true,
  variant = 'sidebar',
}: ConversationDetailProps) {
  const { conversation, isLoading, isError } =
    useGetConversation(conversationId);
  const { data: activeOrg } = useActiveOrganization();
  const { members } = useGetOrganizationMembers(activeOrg?.id ?? '');

  const memberFirstNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      map.set(member.user.id, memberFirstName(member.user.name));
    }
    return map;
  }, [members]);

  const memberFullNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      map.set(member.user.id, member.user.name);
    }
    return map;
  }, [members]);

  const memberImageById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const member of members) {
      map.set(member.user.id, member.user.image ?? null);
    }
    return map;
  }, [members]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (isError || !conversation) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-white p-6">
        <p className="text-center text-sm text-muted-foreground">
          Could not load this conversation.
        </p>
        {onBack ? (
          <Button type="button" variant="outline" size="sm" onClick={onBack}>
            Back to inbox
          </Button>
        ) : null}
      </div>
    );
  }

  const isOpen =
    conversation.status !== 'closed' && conversation.status !== 'expired';

  if (variant === 'mobile') {
    return (
      <MobileConversationView
        conversation={conversation}
        conversationId={conversationId}
        memberFirstNameById={memberFirstNameById}
        memberFullNameById={memberFullNameById}
        memberImageById={memberImageById}
        composerDisabled={!isOpen}
        onBack={onBack}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ConversationHeader
        conversation={conversation}
        currentUserId={currentUserId}
        onDeleted={onDeleted}
        onBack={onBack}
        showInlineBackButton={showInlineBackButton}
      />
      <MessageThread
        conversationId={conversationId}
        conversation={conversation}
      />
      <MessageInput conversationId={conversationId} disabled={!isOpen} />
    </div>
  );
}
