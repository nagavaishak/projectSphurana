import type { ConversationListItem } from '@/features/conversations/api';
import { cn } from '@/lib/utils';

export type ConversationHandlerSource = Pick<
  ConversationListItem,
  'status' | 'assignedToId'
>;

export function getConversationHandlerLabel(
  conversation: ConversationHandlerSource,
  memberFirstNameById: Map<string, string>
): string {
  if (conversation.status === 'bot_handling') {
    return 'Claire AI';
  }
  if (conversation.assignedToId) {
    return memberFirstNameById.get(conversation.assignedToId) ?? 'Agent';
  }
  if (conversation.status === 'agent_handling') {
    return 'Agent';
  }
  return 'Unassigned';
}

export function isClaireAiHandler(
  conversation: ConversationHandlerSource
): boolean {
  return conversation.status === 'bot_handling';
}

interface ConversationHandlerBadgeProps {
  conversation: ConversationHandlerSource;
  memberFirstNameById: Map<string, string>;
  className?: string;
}

export function ConversationHandlerBadge({
  conversation,
  memberFirstNameById,
  className,
}: ConversationHandlerBadgeProps) {
  const isClaire = isClaireAiHandler(conversation);
  const label = getConversationHandlerLabel(conversation, memberFirstNameById);

  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4',
        isClaire
          ? 'bg-[#E8EFFE] text-[#2E65F3]'
          : 'bg-[#F2F2F7] text-[#636366]',
        className
      )}
    >
      {label}
    </span>
  );
}
