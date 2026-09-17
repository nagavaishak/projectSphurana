import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { useGetConversation } from '@/features/conversations/api';
import { MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { ConversationHeader } from './conversation-header';
import { ConversationList } from './conversation-list';
import { ConversationThread } from './conversation-thread';
import { MessageInput } from './message-input';

interface ConversationsTabProps {
  currentUserId?: string;
}

export function ConversationsTab({ currentUserId }: ConversationsTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="flex h-full">
      {/* Left panel - conversation list */}
      <div className="w-[320px] shrink-0 overflow-hidden border-r">
        <ConversationList selectedId={selectedId} onSelect={setSelectedId} />
      </div>

      {/* Right panel - thread */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {selectedId ? (
          <ConversationPane
            conversationId={selectedId}
            currentUserId={currentUserId}
            onDeleted={() => setSelectedId(null)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageCircle />
                </EmptyMedia>
                <EmptyTitle>Select a conversation</EmptyTitle>
                <EmptyDescription>
                  Choose a conversation from the list to view messages and
                  reply.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        )}
      </div>
    </div>
  );
}

function ConversationPane({
  conversationId,
  currentUserId,
  onDeleted,
}: {
  conversationId: string;
  currentUserId?: string;
  onDeleted?: () => void;
}) {
  const { conversation, isLoading } = useGetConversation(conversationId);

  if (isLoading || !conversation) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const isOpen =
    conversation.status !== 'closed' && conversation.status !== 'expired';

  return (
    <>
      <ConversationHeader
        conversation={conversation}
        currentUserId={currentUserId}
        onDeleted={onDeleted}
      />
      <ConversationThread conversationId={conversationId} />
      <MessageInput conversationId={conversationId} disabled={!isOpen} />
    </>
  );
}
