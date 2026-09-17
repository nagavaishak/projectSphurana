import { useChat } from '@ai-sdk/react';
import { apiClient } from '@borradh-workspace/api-client';
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
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import {
  type ClairePrefillEntityType,
  type PromptOverrides,
  asToolPart,
  getToolName,
  useAssistantUsage,
  useConversation,
  useCreateConversation,
  useDeleteConversation,
  useRenameConversation,
} from '@/features/assistant';
import { ArtifactPanel } from '@/features/assistant/_components/artifact-panel';
import {
  ArtifactPanelProvider,
  useArtifactPanel,
  useHasArtifactPanel,
} from '@/features/assistant/_components/artifact-panel-context';
import { PromptTuningPanel } from '@/features/assistant/_components/prompt-tuning-panel';
import { convertStoredToUIMessages } from '@/features/assistant/lib/convert-messages';
import { getAuthToken } from '@/lib/auth-token';
import { resolveApiUrl } from '@/lib/resolve-api-url';

import { ChatSkeleton } from './chat-skeleton';
import { Composer } from './composer';
import { ConversationNotFound } from './error-states';
import { EscalationBanner } from './escalation-banner';
import { MessageList } from './message-list';
import { UsageBanner } from './usage-banner';

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
  /** Files handed off from the home-screen prompt — staged in the composer on mount. */
  initialFiles?: File[];
  /**
   * Arrived from the home-screen prompt: auto-send the draft (+ files) on
   * mount and skip the welcome screen — land straight in a live conversation.
   */
  autoSend?: boolean;
  /**
   * An opening line from Claire, shown before the owner has said anything.
   *
   * Not persisted and not sent to the model — it is the greeting a surface owes
   * its reader. The review page uses it because a chat that opens blank beside
   * a queued post reads as a search box rather than an invitation.
   */
  greeting?: string;
  /**
   * Show the conversation header (title, rename, delete).
   *
   * False on the review page: the page has its own header, and the
   * conversation there is one per post rather than something the owner names
   * or keeps — a title bar over it is a control for managing chats on a screen
   * that is not about chats.
   */
  showHeader?: boolean;
}

export function ChatContainer({
  conversationId,
  onConversationCreated,
  onBack,
  initialDraft,
  initialContext,
  initialFiles,
  autoSend,
  greeting,
  showHeader = true,
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
        initialFiles={initialFiles}
        autoSend={autoSend}
        greeting={greeting}
        showHeader={showHeader}
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
      greeting={greeting}
      showHeader={showHeader}
    />
  );
}

/** Loads stored messages for an existing conversation, then mounts ChatView. */
function ExistingChatView({
  conversationId,
  onBack,
  initialDraft,
  initialContext,
  greeting,
  showHeader,
}: {
  conversationId: string;
  onBack?: () => void;
  initialDraft?: string;
  initialContext?: ChatInitialContext;
  greeting?: string;
  showHeader?: boolean;
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
      greeting={greeting}
      showHeader={showHeader}
    />
  );
}

interface ChatViewProps {
  conversationId?: string;
  initialMessages?: UIMessage[];
  greeting?: string;
  showHeader?: boolean;
  onConversationCreated?: (id: string) => void;
  onBack?: () => void;
  isEscalated?: boolean;
  initialDraft?: string;
  initialContext?: ChatInitialContext;
  initialFiles?: File[];
  autoSend?: boolean;
}

function ChatView({
  conversationId: initialConversationId,
  initialMessages = [],
  greeting,
  showHeader = true,
  onConversationCreated,
  onBack,
  isEscalated,
  initialDraft,
  initialContext,
  initialFiles,
  autoSend,
}: ChatViewProps) {
  const queryClient = useQueryClient();
  const { createConversationAsync } = useCreateConversation();
  const { hasAccess, isDailyLimitReached } = useAssistantUsage();
  const [currentConversationId, setCurrentConversationId] = useState(
    initialConversationId
  );

  // Read HERE, above the provider this component mounts below. Inside it there
  // is always a provider in scope, so the question "did someone else supply
  // one?" becomes unanswerable.
  const hostOwnsPanel = useHasArtifactPanel();

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
        api: resolveApiUrl('assistant/chat'),
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
    setMessages,
    status,
    stop,
    error,
    regenerate,
  } = useChat({
    transport,
    messages: initialMessages,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  // When the latest turn created draft ads, watch their creatives and drop an
  // in-chat "ready to launch?" line once they've all finished rendering.
  useAdLaunchNudge({ messages, status, setMessages });

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

  // Surface the active video draft id (W-C10-clip-tray). Walk messages newest
  // → oldest looking for the most recent `createDraftVideo` tool output that
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
        if (getToolName(tp) !== 'createDraftVideo') continue;
        const out = tp.output as { videoId?: string } | undefined;
        if (out?.videoId) return out.videoId;
        const inp = tp.input as { videoId?: string } | undefined;
        if (inp?.videoId) return inp.videoId;
      }
    }
    return null;
  }, [messages]);

  return (
    <MaybeArtifactPanelProvider>
      <ArtifactPanelSplit hostOwnsPanel={hostOwnsPanel}>
        <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
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

          {showHeader ? (
            <ChatHeader
              conversationId={currentConversationId}
              onBack={onBack}
            />
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* The opening line, until they say something.
                Rendered rather than seeded into `messages` on purpose: it is
                not a turn. Putting it in the transcript would send it to the
                model as something Claire had already said, and she would
                answer a question nobody asked. */}
            {greeting && messages.length === 0 ? (
              <div className="px-4 pt-4">
                <p className="text-sm text-muted-foreground">{greeting}</p>
              </div>
            ) : null}
            <MessageList
              messages={messages}
              status={status}
              error={error ?? null}
              onSendMessage={handleSend}
              onRetry={() => regenerate()}
            />
          </div>

          <UsageBanner />

          {isEscalated && <EscalationBanner />}

          <Composer
            onSend={handleSend}
            onStop={stop}
            status={status}
            isEscalated={isEscalated}
            ensureConversation={ensureConversation}
            initialDraft={initialDraft}
            initialFiles={initialFiles}
            autoSubmit={autoSend}
            activeVideoId={activeVideoId}
          />
        </div>
      </ArtifactPanelSplit>
    </MaybeArtifactPanelProvider>
  );
}

/**
 * A provider, unless a host already supplied one.
 *
 * The chat is mounted standalone at `/assistant` and INSIDE the review page,
 * which owns its own provider so its queue can open artifacts. Nesting a second
 * one would shadow it: the queue would write to the outer, the panel would read
 * the inner, and selecting a post would appear to do nothing.
 */
function MaybeArtifactPanelProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const hasProvider = useHasArtifactPanel();
  if (hasProvider) return <>{children}</>;
  return <ArtifactPanelProvider>{children}</ArtifactPanelProvider>;
}

/**
 * Splits the page when an artifact is open.
 *
 * The handle is shadcn's `ResizableHandle`, so the divider is draggable and the
 * reader decides how much of each they want; a fixed split is wrong for a wide
 * monitor and a laptop at the same time.
 *
 * Takes the chat as `children` rather than being handed its twenty props. The
 * alternative — lifting the chat surface into its own component so this one
 * could compose it — meant threading every piece of chat state through a
 * boundary that exists purely for layout.
 *
 * THE GROUP IS ALWAYS MOUNTED, and `children` always sits at the same position
 * inside it. This is not a style choice; the first version returned a bare
 * fragment when nothing was open and the panel group when something was, and
 * that MOVES `children` in the tree. React does not reconcile across a changed
 * shape — it unmounts the old tree and mounts a new one — so the moment a
 * render finished and the panel opened, the entire chat remounted:
 *
 *   - every card lost its state, so a spent approval card came back offering
 *     Reject and Accept again, as though nothing had happened;
 *   - the composer remounted with `autoSubmit` still set, and RESENT the
 *     message that started the conversation.
 *
 * Only the handle and the right-hand panel are conditional, and they come
 * after `children`, so nothing above them ever moves.
 */
function ArtifactPanelSplit({
  children,
  hostOwnsPanel,
}: {
  children: React.ReactNode;
  /**
   * The host supplied the provider, so it also owns the layout — the review
   * page puts the panel beside a queue rail, which this two-pane split cannot
   * express. Render just the chat and let the host place the panel.
   *
   * Read ABOVE the provider, not inside it: by the time this component runs
   * there is always a provider in scope (its own, if nothing else), so it
   * cannot tell where the provider came from.
   */
  hostOwnsPanel: boolean;
}) {
  const { artifact } = useArtifactPanel();

  if (hostOwnsPanel) return <>{children}</>;

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full min-h-0">
      {/* Explicit `id`: the panel count changes at runtime, and without stable
          identity the library re-derives layout from scratch, so the chat panel
          jumps width when the video one appears. */}
      <ResizablePanel id="chat" defaultSize={artifact ? 60 : 100} minSize={30}>
        {children}
      </ResizablePanel>
      {artifact ? (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel id="artifact" defaultSize={40} minSize={25}>
            {/* Keyed on the artifact: opening a second one must not inherit
                the first one's state — most visibly the carousel, which would
                otherwise open a new deck on whatever slide the last one was
                left on. */}
            <ArtifactPanel
              key={`${artifact.kind}:${artifact.id}`}
              artifact={artifact}
            />
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  );
}

/**
 * In-chat "ready to launch?" nudge for the campaign flow.
 *
 * When the most recent assistant turn created draft ads, this watches their
 * creatives (video / graphic) and, once ALL have finished rendering, appends a
 * single assistant line asking whether to launch. Claire's own turn ends before
 * the renders finish (they're polled client-side), so this is the only way to
 * surface the launch ask in-chat at the right moment.
 *
 * The line is a client-side nudge — it is NOT persisted, so a reload won't
 * replay it. The draft ads themselves persist, so replying "launch" still works.
 */
function useAdLaunchNudge({
  messages,
  status,
  setMessages,
}: {
  messages: UIMessage[];
  status: 'submitted' | 'streaming' | 'ready' | 'error';
  setMessages: (
    messages: UIMessage[] | ((prev: UIMessage[]) => UIMessage[])
  ) => void;
}) {
  const nudgedRef = useRef<Set<string>>(new Set());

  // Only consider the LAST message: if it's an assistant turn that created
  // draft ads (and nothing has happened since), it's a launch candidate. Once
  // the user replies or the nudge is appended, the last message changes and the
  // target clears — so we never nudge an old turn or loop on our own nudge.
  const target = useMemo(() => {
    if (status !== 'ready') return null;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return null;
    const creatives: { kind: 'video' | 'graphic'; id: string }[] = [];
    for (const part of last.parts ?? []) {
      const tp = asToolPart(part);
      if (!tp || getToolName(tp) !== 'createDraftAd') continue;
      const out = tp.output as
        | { preview?: { videoId?: string; graphicId?: string } }
        | undefined;
      if (out?.preview?.videoId) {
        creatives.push({ kind: 'video', id: out.preview.videoId });
      }
      if (out?.preview?.graphicId) {
        creatives.push({ kind: 'graphic', id: out.preview.graphicId });
      }
    }
    if (creatives.length === 0) return null;
    return { messageId: last.id, creatives };
  }, [messages, status]);

  useEffect(() => {
    if (!target || nudgedRef.current.has(target.messageId)) return;

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    const allReady = async (): Promise<boolean> => {
      try {
        const flags = await Promise.all(
          target.creatives.map(async (c) => {
            if (c.kind === 'video') {
              const v = await apiClient.get<{
                status: string;
                blobUrl?: string | null;
              }>(`videos/${c.id}`);
              return v.status === 'ready' && !!v.blobUrl;
            }
            const g = await apiClient.get<{
              status: string;
              outputs?: { url: string; status?: string }[];
            }>(`graphics/${c.id}`);
            return (
              g.status === 'ready' &&
              !!g.outputs?.some((o) => o.status !== 'failed')
            );
          })
        );
        return flags.every(Boolean);
      } catch {
        return false;
      }
    };

    const fire = () => {
      if (cancelled || nudgedRef.current.has(target.messageId)) return;
      nudgedRef.current.add(target.messageId);
      const text =
        target.creatives.length > 1
          ? 'Both ads are ready — want me to launch them?'
          : 'Your ad is ready — want me to launch it?';
      setMessages((prev) => [
        ...prev,
        {
          id: `launch-nudge-${target.messageId}`,
          role: 'assistant',
          parts: [{ type: 'text', text }],
        } as UIMessage,
      ]);
    };

    void (async () => {
      if (await allReady()) {
        fire();
        return;
      }
      interval = setInterval(async () => {
        if (cancelled) return;
        if (await allReady()) {
          if (interval) clearInterval(interval);
          fire();
        }
      }, 4000);
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [target, setMessages]);
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
