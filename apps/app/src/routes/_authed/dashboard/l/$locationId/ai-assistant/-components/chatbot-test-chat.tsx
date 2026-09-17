import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import {
  Bot,
  ExternalLink,
  RefreshCw,
  Send,
  Square,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { getAuthToken } from '@/lib/auth-token';
import { resolveApiUrl } from '@/lib/resolve-api-url';
import { cn } from '@/lib/utils';

export function ChatbotTestChat() {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: resolveApiUrl('chatbots/test-chat'),
        // Web authenticates via the session cookie (getAuthToken is empty
        // there); native sends the bearer header below.
        credentials: 'include',
        headers: (): Record<string, string> => {
          const token = getAuthToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    []
  );

  const {
    messages,
    sendMessage,
    status,
    stop,
    error,
    regenerate,
    setMessages,
  } = useChat({ transport });

  const isActive = status === 'submitted' || status === 'streaming';
  const isEmpty = messages.length === 0;
  const displayName = 'AI';

  // Auto-scroll
  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 100;
    }
  }, []);

  // Track the latest message content for scroll during streaming
  const lastMessageText = messages
    .at(-1)
    ?.parts?.filter(
      (p): p is { type: 'text'; text: string } => p.type === 'text'
    )
    .map((p) => p.text)
    .join('');

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new messages and streaming content
  useEffect(() => {
    if (scrollRef.current && isNearBottomRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [messages.length, lastMessageText]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
      e.target.style.height = 'auto';
      e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
    },
    []
  );

  const handleSend = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isActive) return;
      sendMessage({ text: trimmed });
      setInput('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    },
    [isActive, sendMessage]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      handleSend(input);
    },
    [handleSend, input]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend(input);
      }
    },
    [handleSend, input]
  );

  const handleClear = useCallback(() => {
    setMessages([]);
  }, [setMessages]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Test Chat</span>
        </div>
        {!isEmpty && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={isActive}
            className="h-7 gap-1.5 text-xs text-muted-foreground"
          >
            <Trash2 className="size-3" />
            Clear
          </Button>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {isEmpty && !isActive ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10">
              <Bot className="size-6 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">{displayName}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Send a message to test your chatbot.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3 px-4 py-4">
            {messages.flatMap((message) => {
              const isUser = message.role === 'user';
              const fullText = message.parts
                .filter(
                  (p): p is { type: 'text'; text: string } => p.type === 'text'
                )
                .map((p) => p.text)
                .join('');

              // Split assistant messages into separate bubbles
              // Try ---MSG_BREAK--- first, fall back to double newlines
              let bubbles: string[];
              if (isUser) {
                bubbles = [fullText];
              } else {
                let text = fullText.trim();
                // Strip wrapping quotes the AI sometimes adds
                if (text.startsWith('"') && text.endsWith('"')) {
                  text = text.slice(1, -1);
                }
                // Try to parse as JSON in case the AI returns { "message": "..." }
                if (text.startsWith('{')) {
                  try {
                    const parsed = JSON.parse(text);
                    if (typeof parsed.message === 'string') {
                      text = parsed.message;
                    }
                  } catch {
                    // not JSON, use as-is
                  }
                }
                // Split by ---MSG_BREAK--- or double newlines
                if (text.includes('---MSG_BREAK---')) {
                  bubbles = text
                    .split(/\s*---MSG_BREAK---\s*/g)
                    .filter(Boolean);
                } else {
                  bubbles = text.split(/\n\n+/).filter(Boolean);
                }
              }

              return bubbles.map((text, i) => (
                <div
                  key={`${message.id}-${i}`}
                  className={cn(
                    'flex',
                    isUser ? 'justify-end' : 'justify-start'
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                      isUser
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground'
                    )}
                  >
                    {isUser ? (
                      <p className="whitespace-pre-wrap">{text}</p>
                    ) : (
                      <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                        <Markdown
                          rehypePlugins={[rehypeSanitize]}
                          components={{
                            a: ({ href, children }) => (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5"
                              >
                                {children}
                                <ExternalLink className="inline size-3 shrink-0" />
                              </a>
                            ),
                          }}
                        >
                          {text}
                        </Markdown>
                      </div>
                    )}
                  </div>
                </div>
              ));
            })}

            {/* Thinking indicator */}
            {status === 'submitted' && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                  <div className="flex gap-1">
                    <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
                  </div>
                  <span>Thinking...</span>
                </div>
              </div>
            )}

            {/* Error with retry */}
            {error && status === 'error' && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive dark:bg-destructive/10">
                  <span className="flex-1">
                    {error.message || 'Something went wrong'}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="ml-2 h-6 gap-1 border-destructive/30 text-xs text-destructive hover:bg-destructive/10"
                    onClick={() => regenerate()}
                  >
                    <RefreshCw className="size-3" />
                    Retry
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t p-3">
        <form onSubmit={handleSubmit}>
          <div className="relative flex items-end">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              disabled={isActive}
              className="min-h-[80px] max-h-[160px] resize-none pr-10 text-sm"
              rows={3}
            />
            {isActive ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={stop}
                className="absolute bottom-1 right-1 size-7"
              >
                <Square className="size-3.5" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                disabled={!input.trim()}
                className="absolute bottom-1 right-1 size-7"
              >
                <Send className="size-3.5" />
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
