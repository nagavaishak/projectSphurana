import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ConversationList } from './conversation-list';

interface ConversationDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeId?: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDeleteActive: () => void;
}

export function ConversationDrawer({
  open,
  onOpenChange,
  activeId,
  onSelect,
  onNewChat,
  onDeleteActive,
}: ConversationDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>Conversations</SheetTitle>
        </SheetHeader>
        <ConversationList
          activeId={activeId}
          onSelect={onSelect}
          onNewChat={onNewChat}
          onDeleteActive={onDeleteActive}
        />
      </SheetContent>
    </Sheet>
  );
}
