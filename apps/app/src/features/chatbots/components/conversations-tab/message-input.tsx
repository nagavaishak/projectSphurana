import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useSendMessage } from '@/features/conversations/api';
import { Send } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

interface MessageInputProps {
  conversationId: string;
  disabled?: boolean;
}

export function MessageInput({
  conversationId,
  disabled = false,
}: MessageInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { sendMessage, isSending } = useSendMessage({
    onSuccess: () => {
      setText('');
      textareaRef.current?.focus();
    },
  });

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;

    sendMessage({
      conversationId,
      content: trimmed,
    });
  }, [text, isSending, conversationId, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t p-3">
      {disabled ? (
        <p className="text-center text-sm text-muted-foreground">
          This conversation is closed.
        </p>
      ) : (
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            className="min-h-[40px] max-h-[120px] resize-none"
            disabled={isSending}
          />
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!text.trim() || isSending}
          >
            <Send className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
