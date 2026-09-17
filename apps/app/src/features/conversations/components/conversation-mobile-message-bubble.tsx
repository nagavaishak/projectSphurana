import { AskAiMessageBubble } from '@/features/assistant/_components/ask-ai-message-bubble';
import type { ConversationMessage } from '@/features/conversations/api';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

import type { ConversationHandlerSource } from './conversation-handler-badge';
import { ConversationMessageSenderAvatar } from './conversation-message-sender-avatar';

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;

function isUrlSegment(part: string): boolean {
  return /^https?:\/\/\S+$/.test(part);
}

function renderMessageContent(content: string, isOutbound: boolean): ReactNode {
  const parts = content.split(URL_PATTERN);
  if (parts.length === 1) {
    return content;
  }

  return parts.map((part, index) => {
    if (isUrlSegment(part)) {
      return (
        <a
          key={`${part}-${index}`}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'underline underline-offset-2',
            isOutbound ? 'text-white' : 'text-[#007AFF]'
          )}
        >
          {part}
        </a>
      );
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function isOutboundMessage(role: string): boolean {
  return role === 'bot' || role === 'agent';
}

interface ConversationMobileMessageBubbleProps {
  message: ConversationMessage;
  conversation: ConversationHandlerSource;
  memberFirstNameById: Map<string, string>;
  memberFullNameById: Map<string, string>;
  memberImageById: Map<string, string | null>;
  showDelivered?: boolean;
}

export function ConversationMobileMessageBubble({
  message,
  conversation,
  memberFirstNameById,
  memberFullNameById,
  memberImageById,
  showDelivered = false,
}: ConversationMobileMessageBubbleProps) {
  const isOutbound = isOutboundMessage(message.role);
  const bubbleRole = isOutbound ? 'user' : 'assistant';

  if (!isOutbound) {
    return (
      <div className="flex w-full justify-start">
        <AskAiMessageBubble variant={bubbleRole}>
          <p className="whitespace-pre-wrap break-words">
            {renderMessageContent(message.content ?? '', false)}
          </p>
        </AskAiMessageBubble>
      </div>
    );
  }

  return (
    <div className="flex w-full justify-end gap-2">
      <div className="flex min-w-0 flex-1 flex-col items-end gap-1">
        <AskAiMessageBubble variant={bubbleRole}>
          <p className="whitespace-pre-wrap break-words">
            {renderMessageContent(message.content ?? '', true)}
          </p>
        </AskAiMessageBubble>
        {showDelivered ? (
          <span className="text-[11px] leading-none text-[#8E8E93]">
            Delivered
          </span>
        ) : null}
      </div>
      <ConversationMessageSenderAvatar
        messageRole={message.role}
        conversation={conversation}
        memberFirstNameById={memberFirstNameById}
        memberFullNameById={memberFullNameById}
        memberImageById={memberImageById}
        className="mt-0.5"
      />
    </div>
  );
}
