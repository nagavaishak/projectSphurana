import { useChat } from '@ai-sdk/react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { UIMessage } from 'ai';
import { DefaultChatTransport } from 'ai';
import { AlertCircle, Maximize2, RefreshCw, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputBody,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import { Button } from '@/components/ui/button';
import { ClaireAvatar } from '@/components/ui/claire-avatar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  convertStoredToUIMessages,
  useAssistantUsage,
  useConversation,
  useCreateConversation,
} from '@/features/assistant';
import { assistantApiUrl } from '@/lib/assistant-request';
import { getAuthToken } from '@/lib/auth-token';
import { useClaireWidgetState } from '../lib/widget-state';

/**
 * Mini "quick chat" panel — the v3 demote of the v2 widget panel.
 *
 * The full chat surface is `/assistant`; this panel is intentionally a thin
 * affordance for "quick question without leaving the current page". Mini-panel
 * and full-screen share the active thread through the React Query cache
 * (`useConversation(id)`); clicking the expand icon navigates to
 * `/assistant?id=<id>` and closes the panel.
 *
 * No rich-content renderers, no attachments, no conversation switcher
 * (`claire-conversation-list.tsx` is preserved in this folder for a possible
 * future "switch conversation in mini" affordance — currently unused here).
 *
 * Hidden while a tour is running so the tour's Claire chatbox owns the screen.
 */
export function ClaireChatPanel() {
  const isOpen = useClaireWidgetState((s) => s.isOpen);
  const isTourRunning = useClaireWidgetState((s) => s.isTourRunning);
  const setOpen = useClaireWidgetState((s) => s.setOpen);
  const navigate = useNavigate();

  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);

  const visible = isOpen && !isTourRunning;

  const handleExpand = () => {
    void navigate({
      to: '/assistant',
      search: activeConversationId ? { id: activeConversationId } : {},
    });
    setOpen(false);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="claire-chat-panel"
          role="dialog"
          aria-label="Claire quick chat"
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 12 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          style={{ transformOrigin: 'bottom right' }}
          className="fixed bottom-24 right-6 z-50 flex h-[480px] max-h-[calc(100vh-8rem)] w-[360px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
        >
          <PanelHeader
            conversationId={activeConversationId}
            onExpand={handleExpand}
            onClose={() => setOpen(false)}
          />
          <ChatBody
            key={activeConversationId ?? 'new'}
            conversationId={activeConversationId}
            onConversationCreated={setActiveConversationId}
          />
          <button
            type="button"
            onClick={handleExpand}
            className="border-t bg-muted/30 px-3 py-1.5 text-center text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            View full conversation
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Header — Claire avatar/name + active conversation title + expand + close
// ---------------------------------------------------------------------------

function PanelHeader({
  conversationId,
  onExpand,
  onClose,
}: {
  conversationId: string | null;
  onExpand: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <ClaireAvatar size="sm" className="size-7" />
      <div className="flex flex-1 flex-col leading-tight">
        <span className="text-sm font-semibold">Claire</span>
        {conversationId ? (
          <ConversationTitle conversationId={conversationId} />
        ) : (
          <span className="truncate text-xs text-muted-foreground">
            New chat
          </span>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Open in full screen"
        onClick={onExpand}
        className="size-8"
      >
        <Maximize2 className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Close Claire"
        onClick={onClose}
        className="size-8"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}

function ConversationTitle({ conversationId }: { conversationId: string }) {
  const { conversation } = useConversation(conversationId);
  return (
    <span className="truncate text-xs text-muted-foreground">
      {conversation?.title?.trim() || 'New chat'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Body — loads stored messages for an existing conversation, then mounts chat
// ---------------------------------------------------------------------------

interface ChatBodyProps {
  conversationId: string | null;
  onConversationCreated: (id: string) => void;
}

function ChatBody({ conversationId, onConversationCreated }: ChatBodyProps) {
  if (!conversationId) {
    return (
      <ChatStream
        conversationId={null}
        initialMessages={[]}
        onConversationCreated={onConversationCreated}
      />
    );
  }
  return <ExistingChatBody conversationId={conversationId} />;
}

function ExistingChatBody({ conversationId }: { conversationId: string }) {
  const { messages, isLoading, conversation } = useConversation(conversationId);

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-3">
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="ml-auto h-10 w-1/2" />
        <Skeleton className="h-10 w-2/3" />
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Conversation not found.
      </div>
    );
  }

  return (
    <ChatStream
      conversationId={conversationId}
      initialMessages={convertStoredToUIMessages(messages)}
    />
  );
}

// ---------------------------------------------------------------------------
// Stream — owns useChat, renders message list + composer
// ---------------------------------------------------------------------------

interface ChatStreamProps {
  conversationId: string | null;
  initialMessages: UIMessage[];
  onConversationCreated?: (id: string) => void;
}

function ChatStream({
  conversationId: initialConversationId,
  initialMessages,
  onConversationCreated,
}: ChatStreamProps) {
  const queryClient = useQueryClient();
  const { createConversationAsync } = useCreateConversation();
  const { hasAccess, isDailyLimitReached } = useAssistantUsage();

  const [currentConversationId, setCurrentConversationId] = useState(
    initialConversationId
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: assistantApiUrl('chat'),
        credentials: 'include',
        headers: (): Record<string, string> => {
          const token = getAuthToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    []
  );

  const { messages, sendMessage, status, stop, error, regenerate } = useChat({
    transport,
    messages: initialMessages,
  });

  const isActive = status === 'submitted' || status === 'streaming';
  const isInputDisabled = !hasAccess || isDailyLimitReached;

  useEffect(() => {
    if (status === 'ready' && currentConversationId && messages.length > 0) {
      queryClient.invalidateQueries({
        queryKey: ['assistant', 'conversations'],
      });
      queryClient.invalidateQueries({ queryKey: ['assistant', 'usage'] });
    }
  }, [status, currentConversationId, messages.length, queryClient]);

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (!text || isActive || isInputDisabled) return;

    let convId = currentConversationId;
    if (!convId) {
      try {
        const title = text.length > 80 ? `${text.slice(0, 77)}...` : text;
        const result = await createConversationAsync({ title });
        convId = result.id;
        setCurrentConversationId(convId);
        onConversationCreated?.(convId);
      } catch {
        return;
      }
    }
    sendMessage({ text }, { body: { conversationId: convId } });
  };

  const isEmpty = messages.length === 0;
  const hasError = Boolean(error) && status === 'error';
  // Mini-panel renders the last ~6 turns (12 messages). Older history is
  // available on the full-screen surface via the expand button.
  const visibleMessages = messages.slice(-12);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Conversation className="flex-1">
        {isEmpty && status !== 'submitted' && !hasError ? (
          <ConversationEmptyState
            icon={<ClaireAvatar size="sm" />}
            title="Hi, I'm Claire."
            description="Ask me anything. Hit the expand icon for the full surface."
          />
        ) : (
          <ConversationContent className="gap-3 px-3 py-3">
            {visibleMessages.map((m) => (
              <MiniMessageBubble key={m.id} message={m} />
            ))}
            {status === 'submitted' && <ThinkingIndicator />}
            {hasError && (
              <ErrorBubble
                message={error?.message ?? 'Something went wrong'}
                onRetry={() => regenerate()}
              />
            )}
          </ConversationContent>
        )}
        <ConversationScrollButton />
      </Conversation>

      <PromptInput
        onSubmit={handleSubmit}
        className="rounded-none border-x-0 border-b-0 border-t shadow-none"
      >
        <PromptInputBody>
          <PromptInputTextarea
            placeholder={
              isInputDisabled ? 'Daily chat limit reached' : 'Ask Claire…'
            }
            disabled={isInputDisabled}
            className="min-h-11 text-sm"
          />
        </PromptInputBody>
        <PromptInputTools className="px-2 pb-2">
          <div className="ml-auto flex items-center gap-2">
            <PromptInputSubmit
              status={status}
              onStop={stop}
              disabled={isInputDisabled}
            />
          </div>
        </PromptInputTools>
      </PromptInput>
    </div>
  );
}

// Mini-panel renders text-only messages. Rich-content renderers (confirmation
// cards, video thumbnails, etc.) live in the full-screen `/assistant` surface.
function MiniMessageBubble({ message }: { message: UIMessage }) {
  const text = message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');

  if (!text) return null;

  return (
    <Message from={message.role}>
      <MessageContent>
        {message.role === 'user' ? (
          <p className="whitespace-pre-wrap">{text}</p>
        ) : (
          <MessageResponse>{text}</MessageResponse>
        )}
      </MessageContent>
    </Message>
  );
}

function ThinkingIndicator() {
  return (
    <Message from="assistant">
      <MessageContent>
        <div className="flex items-center gap-1.5 py-1">
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
        </div>
      </MessageContent>
    </Message>
  );
}

function ErrorBubble({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive dark:bg-destructive/10">
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1 border-destructive/30 text-destructive hover:bg-destructive/10"
          onClick={onRetry}
        >
          <RefreshCw className="size-3" />
          Retry
        </Button>
      )}
    </div>
  );
}
