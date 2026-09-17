import { useChat } from '@ai-sdk/react';
import { createFileRoute } from '@tanstack/react-router';
import { DefaultChatTransport } from 'ai';
import {
  Bot,
  ExternalLink,
  Mic,
  MicOff,
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

export const Route = createFileRoute('/_authed/dashboard/voice-test')({
  component: VoiceTestPage,
});

function VoiceTestPage() {
  return (
    <div className="container max-w-7xl py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Voice Cloning A/B Test</h1>
        <p className="text-muted-foreground">
          Compare chatbot responses with and without voice cloning side by side.
        </p>
      </div>
      <div className="grid h-[calc(100vh-12rem)] grid-cols-2 gap-4">
        <div className="flex flex-col overflow-hidden rounded-lg border">
          <ChatPanel
            title="Without Voice Cloning"
            icon={<MicOff className="size-4" />}
            voiceCloning={false}
          />
        </div>
        <div className="flex flex-col overflow-hidden rounded-lg border">
          <ChatPanel
            title="With Voice Cloning"
            icon={<Mic className="size-4" />}
            voiceCloning={true}
            highlight
          />
        </div>
      </div>
    </div>
  );
}

function ChatPanel({
  title,
  icon,
  voiceCloning,
  highlight,
}: {
  title: string;
  icon: React.ReactNode;
  voiceCloning: boolean;
  highlight?: boolean;
}) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Point at NestJS `POST /chatbots/test-chat` with Bearer auth.
  const transport = useMemo(() => {
    return new DefaultChatTransport({
      api: resolveApiUrl('chatbots/test-chat'),
      body: { voiceCloning },
      // Web authenticates via the session cookie (getAuthToken is empty
      // there); native sends the bearer header below.
      credentials: 'include',
      headers: (): Record<string, string> => {
        const token = getAuthToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    });
  }, [voiceCloning]);

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

  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 100;
    }
  }, []);

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
    <>
      <div
        className={cn(
          'flex items-center justify-between border-b px-4 py-3',
          highlight && 'bg-primary/5'
        )}
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium">{title}</span>
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
              <p className="text-sm font-medium">{title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Send a message to test.
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

              let bubbles: string[];
              if (isUser) {
                bubbles = [fullText];
              } else {
                let text = fullText.trim();
                if (text.startsWith('"') && text.endsWith('"')) {
                  text = text.slice(1, -1);
                }
                if (text.startsWith('{')) {
                  try {
                    const parsed = JSON.parse(text);
                    if (typeof parsed.message === 'string') {
                      text = parsed.message;
                    }
                  } catch {
                    // not JSON
                  }
                }
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
              className="min-h-[60px] max-h-[120px] resize-none pr-10 text-sm"
              rows={2}
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
    </>
  );
}
