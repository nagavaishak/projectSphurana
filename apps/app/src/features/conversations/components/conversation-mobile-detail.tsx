import { Skeleton } from '@/components/ui/skeleton';
import type {
  Conversation,
  ConversationMessage,
} from '@/features/conversations/api';
import { useMobileDashboardHeaderContent } from '@/features/mobile-dashboard-header';
import { cn } from '@/lib/utils';
import { useMemo } from 'react';

import { ConversationHandlerBadge } from './conversation-handler-badge';
import { ConversationMobileComposer } from './conversation-mobile-composer';
import {
  ConversationMobileMessageThread,
  useConversationMobileComposerLayout,
} from './conversation-mobile-message-thread';
import { ConversationPlatformAvatar } from './conversation-platform-avatar';

interface ConversationMobileDetailProps {
  conversation: Conversation;
  messages: ConversationMessage[];
  memberFirstNameById: Map<string, string>;
  memberFullNameById: Map<string, string>;
  memberImageById: Map<string, string | null>;
  isLoadingMessages?: boolean;
  onSend: (content: string) => void;
  isSending?: boolean;
  composerDisabled?: boolean;
  onBack?: () => void;
}

function ConversationMobileHeaderCenter({
  conversation,
  memberFirstNameById,
}: {
  conversation: Conversation;
  memberFirstNameById: Map<string, string>;
}) {
  const displayName =
    conversation.externalUserName ?? conversation.externalUserId;

  return (
    <div className="flex min-w-0 flex-col items-center gap-1 py-0.5">
      <ConversationPlatformAvatar
        name={displayName}
        avatarUrl={conversation.externalUserAvatar}
        platform={conversation.platform}
        size="thread"
      />
      <div className="flex max-w-full flex-col items-center gap-0.5">
        <p className="max-w-full truncate text-[16px] font-bold leading-tight tracking-[-0.2px] text-[#0A0A0A]">
          {displayName}
        </p>
        <ConversationHandlerBadge
          conversation={conversation}
          memberFirstNameById={memberFirstNameById}
          className="px-2 py-px text-[11px] font-medium leading-4"
        />
      </div>
    </div>
  );
}

export function ConversationMobileDetail({
  conversation,
  messages,
  memberFirstNameById,
  memberFullNameById,
  memberImageById,
  isLoadingMessages = false,
  onSend,
  isSending = false,
  composerDisabled = false,
  onBack,
}: ConversationMobileDetailProps) {
  const { composerLayoutVersion, onComposerLayoutChange } =
    useConversationMobileComposerLayout();

  const centerSlot = useMemo(
    () => (
      <ConversationMobileHeaderCenter
        conversation={conversation}
        memberFirstNameById={memberFirstNameById}
      />
    ),
    [conversation, memberFirstNameById]
  );

  useMobileDashboardHeaderContent({
    showBack: true,
    onBack,
    hideNotifications: true,
    alignItemsTop: true,
    centerSlot,
    hideTrailing: true,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      {isLoadingMessages ? (
        <div className="flex flex-1 flex-col gap-2.5 px-4 py-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton
              key={index}
              className={cn(
                'h-11 w-[72%] rounded-[20px]',
                index % 2 === 1 && 'ml-auto w-[64%]'
              )}
            />
          ))}
        </div>
      ) : messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 py-8">
          <p className="text-center text-[15px] text-[#8E8E93]">
            No messages yet in this conversation.
          </p>
        </div>
      ) : (
        <ConversationMobileMessageThread
          conversation={conversation}
          messages={messages}
          memberFirstNameById={memberFirstNameById}
          memberFullNameById={memberFullNameById}
          memberImageById={memberImageById}
          composerLayoutVersion={composerLayoutVersion}
        />
      )}

      {composerDisabled ? (
        <div className="shrink-0 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5">
          <p className="text-center text-[15px] text-[#8E8E93]">
            This conversation is closed.
          </p>
        </div>
      ) : (
        <ConversationMobileComposer
          onSend={onSend}
          disabled={composerDisabled}
          isSending={isSending}
          onLayoutChange={onComposerLayoutChange}
        />
      )}
    </div>
  );
}
