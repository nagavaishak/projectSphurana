import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { Sparkles } from 'lucide-react';

import {
  type ConversationHandlerSource,
  isClaireAiHandler,
} from './conversation-handler-badge';

function memberInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

interface ConversationMessageSenderAvatarProps {
  messageRole: string;
  conversation: ConversationHandlerSource;
  memberFirstNameById: Map<string, string>;
  memberFullNameById: Map<string, string>;
  memberImageById: Map<string, string | null>;
  className?: string;
}

/**
 * Non-interactive sender avatar for outbound messages — agent photo with a
 * Claire sparkle badge at the bottom-right (same slot on every sent message).
 */
export function ConversationMessageSenderAvatar({
  messageRole,
  conversation,
  memberFirstNameById,
  memberFullNameById,
  memberImageById,
  className,
}: ConversationMessageSenderAvatarProps) {
  const isBotMessage = messageRole === 'bot';
  const assignedId = conversation.assignedToId;

  if (isBotMessage || (isClaireAiHandler(conversation) && !assignedId)) {
    return (
      <div className={cn('relative size-9 shrink-0', className)} aria-hidden>
        <div className="flex size-9 items-center justify-center rounded-full bg-[#2E65F3] shadow-[0_2px_8px_rgba(46,101,243,0.28)]">
          <Sparkles className="size-[18px] text-white" strokeWidth={2.25} />
        </div>
      </div>
    );
  }

  const displayName =
    (assignedId ? memberFullNameById.get(assignedId) : undefined) ??
    (assignedId ? memberFirstNameById.get(assignedId) : undefined) ??
    'Agent';
  const imageUrl = assignedId ? memberImageById.get(assignedId) : null;

  return (
    <div className={cn('relative size-9 shrink-0', className)} aria-hidden>
      <Avatar className="size-9 border-2 border-white bg-[#F2F2F7]">
        {imageUrl ? <AvatarImage src={imageUrl} alt={displayName} /> : null}
        <AvatarFallback className="bg-[#F2F2F7] text-[11px] font-semibold text-[#3C3C43]">
          {memberInitials(displayName)}
        </AvatarFallback>
      </Avatar>
      <div className="absolute -bottom-0.5 -right-0.5 flex size-[18px] items-center justify-center rounded-full bg-[#2E65F3] ring-2 ring-white">
        <Sparkles className="size-2.5 text-white" strokeWidth={2.5} />
      </div>
    </div>
  );
}
