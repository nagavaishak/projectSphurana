import { Fragment, useCallback, useEffect, useRef, useState } from 'react';

import type {
  Conversation,
  ConversationMessage,
} from '@/features/conversations/api';
import { cn } from '@/lib/utils';

import { AdReferralCard } from './ad-referral-card';
import { ConversationMobileMessageBubble } from './conversation-mobile-message-bubble';
import { DaySeparatorBadge, dayKey, formatDayLabel } from './day-separator';

function isOutboundMessage(role: string): boolean {
  return role === 'bot' || role === 'agent';
}

function findLastOutboundIndex(messages: ConversationMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isOutboundMessage(messages[index]?.role ?? '')) {
      return index;
    }
  }
  return -1;
}

interface ConversationMobileMessageThreadProps {
  conversation: Conversation;
  messages: ConversationMessage[];
  memberFirstNameById: Map<string, string>;
  memberFullNameById: Map<string, string>;
  memberImageById: Map<string, string | null>;
  className?: string;
  composerLayoutVersion?: number;
}

export function ConversationMobileMessageThread({
  conversation,
  messages,
  memberFirstNameById,
  memberFullNameById,
  memberImageById,
  className,
  composerLayoutVersion = 0,
}: ConversationMobileMessageThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastOutboundIndex = findLastOutboundIndex(messages);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when message list or composer height changes
  useEffect(() => {
    scrollToBottom();
  }, [messages.length, composerLayoutVersion, scrollToBottom]);

  return (
    <div
      className={cn(
        'min-h-0 flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]',
        className
      )}
    >
      <div className="flex flex-col gap-2.5 px-4 py-3">
        <AdReferralCard metadata={conversation.metadata} />
        {messages.map((message, index) => {
          const isLastOutbound = index === lastOutboundIndex;
          const iso = message.sentAt ?? message.createdAt;
          const prev = index > 0 ? messages[index - 1] : null;
          const prevIso = prev ? (prev.sentAt ?? prev.createdAt) : null;
          const showDayBadge = !prevIso || dayKey(prevIso) !== dayKey(iso);
          return (
            <Fragment key={message.id}>
              {showDayBadge ? (
                <DaySeparatorBadge label={formatDayLabel(new Date(iso))} />
              ) : null}
              <ConversationMobileMessageBubble
                message={message}
                conversation={conversation}
                memberFirstNameById={memberFirstNameById}
                memberFullNameById={memberFullNameById}
                memberImageById={memberImageById}
                showDelivered={isLastOutbound}
              />
            </Fragment>
          );
        })}
        <div ref={bottomRef} aria-hidden />
      </div>
    </div>
  );
}

/** Hook for composer resize → thread scroll (Ask AI sheet parity). */
export function useConversationMobileComposerLayout() {
  const [composerLayoutVersion, setComposerLayoutVersion] = useState(0);
  const onComposerLayoutChange = useCallback(() => {
    setComposerLayoutVersion((v) => v + 1);
  }, []);
  return { composerLayoutVersion, onComposerLayoutChange };
}
