import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

type AskAiMessageBubbleVariant = 'user' | 'assistant';

interface AskAiMessageBubbleProps {
  variant: AskAiMessageBubbleVariant;
  children: ReactNode;
  className?: string;
}

/**
 * iMessage-style bubble for the mobile Ask AI sheet only.
 * User: blue (#007AFF), tail bottom-right. Assistant: gray (#E9E9EB), tail bottom-left.
 */
export function AskAiMessageBubble({
  variant,
  children,
  className,
}: AskAiMessageBubbleProps) {
  const isUser = variant === 'user';

  return (
    <div
      className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}
    >
      <div
        className={cn(
          'relative max-w-[88%] px-4 py-2.5 text-[15px] leading-snug',
          isUser
            ? 'rounded-[20px] rounded-br-[5px] bg-[#007AFF] text-white'
            : 'rounded-[20px] rounded-bl-[5px] bg-[#E9E9EB] text-[#0A0A0A]',
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}
