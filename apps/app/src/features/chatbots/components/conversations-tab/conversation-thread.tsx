import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useListMessages } from '@/features/conversations/api';
import type { ConversationMessage } from '@/features/conversations/api';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Bot, Headset, User } from 'lucide-react';
import { useEffect, useRef } from 'react';

interface ConversationThreadProps {
  conversationId: string;
}

const roleConfig: Record<
  string,
  {
    align: 'left' | 'right';
    bg: string;
    icon: React.ElementType;
    label: string;
  }
> = {
  bot: { align: 'left', bg: 'bg-muted', icon: Bot, label: 'Bot' },
  user: {
    align: 'right',
    bg: 'bg-primary text-primary-foreground',
    icon: User,
    label: 'User',
  },
  agent: {
    align: 'left',
    bg: 'bg-blue-100 dark:bg-blue-950',
    icon: Headset,
    label: 'Agent',
  },
  system: {
    align: 'left',
    bg: 'bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800',
    icon: Bot,
    label: 'System',
  },
};

function MessageBubble({ message }: { message: ConversationMessage }) {
  const isSynced =
    message.role === 'bot' &&
    message.metadata &&
    typeof message.metadata === 'object' &&
    'synced' in message.metadata &&
    (message.metadata as Record<string, unknown>).synced === true;
  const config = roleConfig[message.role] ?? roleConfig.bot;
  const isRight = config.align === 'right';
  const Icon = isSynced ? User : config.icon;
  const label = isSynced ? null : config.label;

  return (
    <div
      className={cn(
        'flex gap-2 max-w-[80%]',
        isRight && 'ml-auto flex-row-reverse'
      )}
    >
      <div className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
      <div>
        <div className={cn('rounded-lg px-3 py-2 text-sm', config.bg)}>
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
        <p
          className={cn(
            'mt-0.5 text-[10px] text-muted-foreground',
            isRight && 'text-right'
          )}
        >
          {label ? `${label} \u00b7 ` : ''}
          {format(new Date(message.sentAt ?? message.createdAt), 'HH:mm')}
        </p>
      </div>
    </div>
  );
}

export function ConversationThread({
  conversationId,
}: ConversationThreadProps) {
  const { messages, isLoading } = useListMessages(conversationId, {
    limit: 200,
  });
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (messages.length !== prevCountRef.current) {
      prevCountRef.current = messages.length;
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

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
      <div className="flex flex-1 items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">
          No messages yet in this conversation.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-3 p-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
