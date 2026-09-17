import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { MessageSquare } from 'lucide-react';

export function ConversationEmpty() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageSquare />
          </EmptyMedia>
          <EmptyTitle>Select a conversation</EmptyTitle>
          <EmptyDescription>
            Choose a conversation from the list to view messages and reply.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
