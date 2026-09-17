import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  conversationStatusLabels,
  messagingPlatformLabels,
} from '@/features/conversations/api';
import type { Conversation } from '@/features/conversations/api';
import {
  useAssignConversation,
  useCloseConversation,
  useDeleteConversation,
} from '@/features/conversations/api';
import { Trash2, UserCheck, XCircle } from 'lucide-react';

interface ConversationHeaderProps {
  conversation: Conversation;
  currentUserId?: string;
  onDeleted?: () => void;
}

export function ConversationHeader({
  conversation,
  currentUserId,
  onDeleted,
}: ConversationHeaderProps) {
  const { closeConversation, isClosing } = useCloseConversation();
  const { assignConversation, isAssigning } = useAssignConversation();
  const { deleteConversation, isDeleting } = useDeleteConversation({
    onSuccess: onDeleted,
  });

  const isOpen =
    conversation.status !== 'closed' && conversation.status !== 'expired';
  const isAssignedToMe = conversation.assignedToId === currentUserId;

  return (
    <div className="flex items-center justify-between border-b px-4 py-3">
      <div className="flex items-center gap-3">
        <Avatar className="size-8">
          {conversation.externalUserAvatar && (
            <AvatarImage src={conversation.externalUserAvatar} />
          )}
          <AvatarFallback className="text-xs">
            {(conversation.externalUserName ?? conversation.externalUserId)
              .charAt(0)
              .toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div>
          <p className="text-sm font-medium">
            {conversation.externalUserName ?? conversation.externalUserId}
          </p>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {conversationStatusLabels[conversation.status]}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {messagingPlatformLabels[conversation.platform]}
            </span>
          </div>
        </div>
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
                {isAssigning ? 'Assigning...' : 'Assign to me'}
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
