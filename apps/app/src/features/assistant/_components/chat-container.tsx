import { useChat } from '@ai-sdk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  DefaultChatTransport,
  type FileUIPart,
  type UIMessage,
  lastAssistantMessageIsCompleteWithToolCalls,
} from 'ai';
import { ChevronDown, Pencil, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  type ClairePrefillEntityType,
  type PromptOverrides,
  useAssistantUsage,
  useConversation,
  useCreateConversation,
  useDeleteConversation,
  useRenameConversation,
} from '@/features/assistant';
import { convertStoredToUIMessages } from '@/features/assistant/lib/convert-messages';
import { assistantApiUrl } from '@/lib/assistant-request';
import { getAuthToken } from '@/lib/auth-token';

import { AskAiMobileWelcome } from './ask-ai-mobile-welcome';
import { ChatSkeleton } from './chat-skeleton';
import { Composer } from './composer';
import { ConversationNotFound } from './error-states';
import { MessageList } from './message-list';
import { PromptTuningPanel } from './prompt-tuning-panel';
import { asToolPart, getToolName } from './tool-parts';
import { UsageBanner } from './usage-banner';
import { WelcomeScreen } from './welcome-screen';

/**
 * Per-turn entity hint forwarded from `/assistant?entityType=…&entityId=…`
 * (W-C18 page-integrations). The composer fires this with the **first**
 * sendMessage only; the controller appends a one-line system block
 * ("Active context: lead abc123. Use this context if relevant."). After
 * the first send the context is consumed — subsequent turns inherit
 * naturally via conversation history.
 */
export interface ChatInitialContext {
  entityType: ClairePrefillEntityType;
  entityId: string;
}

/**
 * Local prompt-tuning state (uncommitted dev tool). Overrides live in
 * sessionStorage so they survive navigation within a tab but never persist to
 * the server. Sent with each chat request; the controller applies them on top
 * of the registered defaults. See `PromptTuningPanel`.
 */
const PROMPT_OVERRIDES_KEY = 'claire-prompt-overrides';

/** Drop empty fields so an untouched panel sends no override payload. */
function prunePromptOverrides(o: PromptOverrides): PromptOverrides | undefined {
  const out: PromptOverrides = {};
  if (o.persona !== undefined) out.persona = o.persona;
  if (o.skillIndex !== undefined) out.skillIndex = o.skillIndex;
  if (o.businessContext !== undefined) out.businessContext = o.businessContext;
  if (o.skillFragments && Object.keys(o.skillFragments).length)
    out.skillFragments = o.skillFragments;
  if (o.toolDescriptions && Object.keys(o.toolDescriptions).length)
    out.toolDescriptions = o.toolDescriptions;
  if (o.extraDirectives?.trim()) out.extraDirectives = o.extraDirectives;
  return Object.keys(out).length ? out : undefined;
}

interface ChatContainerProps {
  conversationId?: string;
  onConversationCreated?: (id: string) => void;
  /** Navigate back to the conversation list (e.g. after delete or explicit back). */
  onBack?: () => void;
  initialDraft?: string;
  initialContext?: ChatInitialContext;
  /** Fired when the in-memory message list length changes (mobile Ask AI toolbar parity). */
  onMessagesChange?: (messageCount: number) => void;
  /** Fired when the live conversation id changes (mobile delete / history parity). */
  onActiveConversationIdChange?: (conversationId: string | undefined) => void;
  /** When `askAiMobile`, matches `ask-ai-clone` Ask AI modal (no header row, empty spacer, composer chrome). */
  sheetPresentation?: 'default' | 'askAiMobile';
}

export function ChatContainer({
  conversationId,
  onConversationCreated,
  onBack,
  initialDraft,
  initialContext,
  onMessagesChange,
  onActiveConversationIdChange,
  sheetPresentation = 'default',
}: ChatContainerProps) {
  // Keep the rendering mode stable for the lifetime of this mount:
  // if the user opened "new chat", continue with local ChatView state even
  // after URL updates to ?id=... so in-flight first-send responses aren't lost.
  const mountedWithConversationRef = useRef(Boolean(conversationId));

  if (!mountedWithConversationRef.current || !conversationId) {
    return (
      <ChatView
        onConversationCreated={onConversationCreated}
        onBack={onBack}
        initialDraft={initialDraft}
        initialContext={initialContext}
        onMessagesChange={onMessagesChange}
        onActiveConversationIdChange={onActiveConversationIdChange}
        sheetPresentation={sheetPresentation}
      />
    );
  }
  return (
    <ExistingChatView
      key={conversationId}
      conversationId={conversationId}
      onBack={onBack}
      initialDraft={initialDraft}
      initialContext={initialContext}
      onMessagesChange={onMessagesChange}
      onActiveConversationIdChange={onActiveConversationIdChange}
      sheetPresentation={sheetPresentation}
    />
  );
}

/** Loads stored messages for an existing conversation, then mounts ChatView. */
function ExistingChatView({
  conversationId,
  onBack,
  initialDraft,
  initialContext,
  onMessagesChange,
  onActiveConversationIdChange,
  sheetPresentation = 'default',
}: {
  conversationId: string;
  onBack?: () => void;
  initialDraft?: string;
  initialContext?: ChatInitialContext;
  onMessagesChange?: (messageCount: number) => void;
  onActiveConversationIdChange?: (conversationId: string | undefined) => void;
  sheetPresentation?: 'default' | 'askAiMobile';
}) {
  const { messages, isLoading, conversation } = useConversation(conversationId);

  if (isLoading) return <ChatSkeleton />;
  if (!conversation) return <ConversationNotFound />;

  const initialMessages = convertStoredToUIMessages(messages);
  return (
    <ChatView
      conversationId={conversationId}
      initialMessages={initialMessages}
      isEscalated={conversation.status === 'escalated'}
      onBack={onBack}
      initialDraft={initialDraft}
      initialContext={initialContext}
      onMessagesChange={onMessagesChange}
      onActiveConversationIdChange={onActiveConversationIdChange}
      sheetPresentation={sheetPresentation}
    />
  );
}

interface ChatViewProps {
  conversationId?: string;
  initialMessages?: UIMessage[];
  onConversationCreated?: (id: string) => void;
  onBack?: () => void;
  isEscalated?: boolean;
  initialDraft?: string;
  initialContext?: ChatInitialContext;
  onMessagesChange?: (messageCount: number) => void;
  onActiveConversationIdChange?: (conversationId: string | undefined) => void;
  sheetPresentation?: 'default' | 'askAiMobile';
}

function ChatView({
  conversationId: initialConversationId,
  initialMessages = [],
  onConversationCreated,
  onBack,
  isEscalated,
  initialDraft,
  initialContext,
  onMessagesChange,
  onActiveConversationIdChange,
  sheetPresentation = 'default',
}: ChatViewProps) {
  const queryClient = useQueryClient();
  const { createConversationAsync } = useCreateConversation();
  const { hasAccess, isDailyLimitReached } = useAssistantUsage();
  const [currentConversationId, setCurrentConversationId] = useState(
    initialConversationId
  );
  const [composerLayoutVersion, setComposerLayoutVersion] = useState(0);
  const bumpComposerLayout = useCallback(() => {
    setComposerLayoutVersion((v) => v + 1);
  }, []);

  // Local prompt-tuning overrides (dev tool) — seeded from sessionStorage,
  // sent with each send, never persisted server-side.
  const [tuningOpen, setTuningOpen] = useState(false);
  const [promptOverrides, setPromptOverrides] = useState<PromptOverrides>(
    () => {
      try {
        const raw = window.sessionStorage.getItem(PROMPT_OVERRIDES_KEY);
        return raw ? (JSON.parse(raw) as PromptOverrides) : {};
      } catch {
        return {};
      }
    }
  );
  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        PROMPT_OVERRIDES_KEY,
        JSON.stringify(promptOverrides)
      );
    } catch {
      /* sessionStorage unavailable — ignore (dev tool) */
    }
  }, [promptOverrides]);

  // One-shot active context (W-C18). Held in a ref so consumption doesn't
  // re-render: on the first send we read + clear, subsequent sends find
  // `null` and omit the body fields. We use a ref rather than state so the
  // back-to-back send case (rapid first send then a queued second send)
  // can't double-fire from a stale closure.
  const pendingInitialContextRef = useRef<ChatInitialContext | null>(
    initialContext ?? null
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: assistantApiUrl('chat'),
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
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  useEffect(() => {
    onMessagesChange?.(messages.length);
  }, [messages.length, onMessagesChange]);

  useEffect(() => {
    onActiveConversationIdChange?.(currentConversationId);
  }, [currentConversationId, onActiveConversationIdChange]);

  // Refresh sidebar + usage after each completed assistant turn.
  useEffect(() => {
    if (status === 'ready' && currentConversationId && messages.length > 0) {
      queryClient.invalidateQueries({
        queryKey: ['assistant', 'conversations'],
      });
      queryClient.invalidateQueries({ queryKey: ['assistant', 'usage'] });
    }
  }, [status, currentConversationId, messages.length, queryClient]);

  // Track currentConversationId via ref so `ensureConversation` (consumed
  // by the composer for image uploads) doesn't capture a stale value when
  // multiple uploads kick off back-to-back before the state update settles.
  const currentConversationIdRef = useRef(currentConversationId);
  useEffect(() => {
    currentConversationIdRef.current = currentConversationId;
  }, [currentConversationId]);

  const ensureConversation = useCallback(async (): Promise<string> => {
    const existing = currentConversationIdRef.current;
    if (existing) return existing;
    const result = await createConversationAsync({});
    currentConversationIdRef.current = result.id;
    setCurrentConversationId(result.id);
    onConversationCreated?.(result.id);
    return result.id;
  }, [createConversationAsync, onConversationCreated]);

  // Returns `false` when the send is refused (guards, failed conversation
  // creation) so the composer can restore its optimistically-cleared draft.
  const handleSend = useCallback(
    async (text: string, files?: FileUIPart[]): Promise<boolean> => {
      const trimmed = text.trim();
      const hasFiles = !!files && files.length > 0;
      if (!trimmed && !hasFiles) return false;
      if (status === 'submitted' || status === 'streaming') return false;
      if (!hasAccess || isDailyLimitReached || isEscalated) return false;

      let convId = currentConversationIdRef.current;
      if (!convId) {
        try {
          // Use the user's text for the title when present; image-only
          // sends fall back to the default title (the controller's
          // `generateConversationTitle` runs after the first exchange).
          const title = trimmed
            ? trimmed.length > 100
              ? `${trimmed.slice(0, 97)}...`
              : trimmed
            : undefined;
          const result = await createConversationAsync(title ? { title } : {});
          convId = result.id;
          currentConversationIdRef.current = convId;
          setCurrentConversationId(convId);
          onConversationCreated?.(convId);
        } catch {
          return false;
        }
      }
      // First-send-after-navigation only: include the W-C18 entity hint.
      // After consuming, clear so subsequent turns omit (per the brief —
      // conversation history carries the context naturally).
      const pendingContext = pendingInitialContextRef.current;
      pendingInitialContextRef.current = null;

      const requestBody: {
        conversationId: string;
        entityType?: ClairePrefillEntityType;
        entityId?: string;
        overrides?: PromptOverrides;
      } = { conversationId: convId };
      if (pendingContext) {
        requestBody.entityType = pendingContext.entityType;
        requestBody.entityId = pendingContext.entityId;
      }
      // Live prompt-tuning overrides (dev tool) — only sent when non-empty.
      const pruned = prunePromptOverrides(promptOverrides);
      if (pruned) requestBody.overrides = pruned;

      sendMessage(hasFiles ? { text: trimmed, files } : { text: trimmed }, {
        body: requestBody,
      });
      return true;
    },
    [
      status,
      hasAccess,
      isDailyLimitReached,
      isEscalated,
      createConversationAsync,
      onConversationCreated,
      sendMessage,
      promptOverrides,
    ]
  );

  const isEmpty = messages.length === 0;

  // Surface the active video draft id (W-C10-clip-tray). Walk messages newest
  // → oldest looking for the most recent `createContent` tool output that
  // carries a `videoId`. The composer mounts the persistent clip tray when
  // this is non-null and routes `video/*` drops into the asset-library
  // ingest path. Conversations without a draft see an unchanged composer.
  const activeVideoId = useMemo<string | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg?.parts) continue;
      for (const part of msg.parts) {
        const tp = asToolPart(part);
        if (!tp) continue;
        if (getToolName(tp) !== 'createContent') continue;
        const out = tp.output as { videoId?: string } | undefined;
        if (out?.videoId) return out.videoId;
        const inp = tp.input as { videoId?: string } | undefined;
        if (inp?.videoId) return inp.videoId;
      }
    }
    return null;
  }, [messages]);

  const isWelcomeState =
    isEmpty && status !== 'submitted' && status !== 'streaming';

  const isAskAiMobile = sheetPresentation === 'askAiMobile';

  const composerProps = {
    onSend: handleSend,
    onStop: stop,
    status,
    isEscalated,
    ensureConversation,
    initialDraft,
    activeVideoId,
    ...(isAskAiMobile
      ? ({
          noBottomPadding: true,
          compact: true,
          onMobileLayoutChange: bumpComposerLayout,
        } as const)
      : {}),
  } as const;

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col">
      {/* Local prompt-tuning trigger (dev tool, not committed). Dev-only. */}
      {import.meta.env.DEV && (
        <>
          <button
            type="button"
            onClick={() => setTuningOpen(true)}
            title="Prompt tuning (local dev tool)"
            className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-md border bg-background/80 px-2 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-accent"
          >
            <SlidersHorizontal className="size-3.5" />
            Prompt
          </button>
          <PromptTuningPanel
            open={tuningOpen}
            onOpenChange={setTuningOpen}
            conversationId={currentConversationId}
            overrides={promptOverrides}
            onOverridesChange={setPromptOverrides}
          />
        </>
      )}

      {!isAskAiMobile && (
        <ChatHeader conversationId={currentConversationId} onBack={onBack} />
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {isWelcomeState ? (
          isAskAiMobile ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 -mx-4">
                <AskAiMobileWelcome onQuickAction={handleSend} />
              </div>
              <div className="shrink-0 pt-3">
                <Composer {...composerProps} />
              </div>
            </div>
          ) : (
            <WelcomeScreen
              onQuickAction={handleSend}
              composer={<Composer {...composerProps} />}
            />
          )
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <MessageList
              messages={messages}
              status={status}
              error={error ?? null}
              onSendMessage={handleSend}
              onRetry={() => regenerate()}
              compact={isAskAiMobile}
              composerLayoutVersion={
                isAskAiMobile ? composerLayoutVersion : undefined
              }
            />
          </div>
        )}
      </div>

      {!isWelcomeState && <UsageBanner compact={isAskAiMobile} />}

      {!isWelcomeState && <Composer {...composerProps} />}
    </div>
  );
}

interface ChatHeaderProps {
  conversationId?: string;
  onBack?: () => void;
}

function ChatHeader({ conversationId, onBack }: ChatHeaderProps) {
  const { conversation } = useConversation(conversationId ?? '');
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const { renameConversation, isRenaming } = useRenameConversation();
  const { deleteConversation, isDeleting } = useDeleteConversation({
    onSuccess: onBack,
  });

  const openRename = () => {
    setRenameTitle(conversation?.title ?? '');
    setRenameOpen(true);
  };

  const saveRename = () => {
    const trimmed = renameTitle.trim();
    if (conversationId && trimmed && trimmed !== conversation?.title) {
      renameConversation({ id: conversationId, title: trimmed });
    }
    setRenameOpen(false);
  };

  useEffect(() => {
    if (renameOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [renameOpen]);

  const title =
    conversation?.title || (conversationId ? 'Conversation' : 'Ask Claire AI');

  return (
    <>
      <div className="flex items-center border-b px-4 py-3">
        {conversationId ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold hover:bg-accent transition-colors"
              >
                <span className="max-w-xs truncate">{title}</span>
                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuItem onClick={openRename}>
                <Pencil className="mr-2 size-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="mr-2 size-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="px-2 text-sm font-semibold">{title}</span>
        )}
      </div>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
          </DialogHeader>
          <Input
            ref={inputRef}
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveRename();
              if (e.key === 'Escape') setRenameOpen(false);
            }}
            placeholder="Conversation name"
            maxLength={100}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveRename} disabled={isRenaming}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        description="The conversation and every message in it are permanently deleted. This action cannot be undone."
        isPending={isDeleting}
        onConfirm={() => conversationId && deleteConversation(conversationId)}
        onOpenChange={setDeleteOpen}
        open={deleteOpen}
        title={<>Delete &ldquo;{title}&rdquo;?</>}
      />
    </>
  );
}
