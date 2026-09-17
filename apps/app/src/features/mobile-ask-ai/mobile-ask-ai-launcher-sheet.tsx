'use client';

import {
  ArrowLeft,
  ArrowUp,
  ChartLine,
  ChevronRight,
  History,
  Image as ImageIcon,
  Megaphone,
  Pencil,
  Search,
  Sparkles,
  Target,
  UserPlus,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Drawer } from 'vaul';

import { Skeleton } from '@/components/ui/skeleton';
import { useAssistantUsage, useConversations } from '@/features/assistant';
import type { ConversationSummary } from '@/features/assistant';
import { cn } from '@/lib/utils';
import {
  ChatContainer,
  ChatSkeleton,
  FreeTierGate,
} from '@/routes/_authed/assistant/-components';

import { useVisualViewportKeyboardInset } from './use-visual-viewport-keyboard-inset';

interface MobileAskAiLauncherSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SheetView = 'launcher' | 'chat' | 'history';

interface ChipPrompt {
  id: string;
  label: string;
  icon: LucideIcon;
  prompt: string;
}

const CHIPS: ChipPrompt[] = [
  {
    id: 'create-graphic',
    label: 'Create a graphic',
    icon: ImageIcon,
    prompt: 'I want to create a graphic for my clinic.',
  },
  {
    id: 'launch-ad',
    label: 'Launch an ad',
    icon: Megaphone,
    prompt: 'I want to launch a new ad campaign.',
  },
  {
    id: 'plan-campaign',
    label: 'Plan a campaign',
    icon: Target,
    prompt: 'Help me plan a marketing campaign for my clinic.',
  },
  {
    id: 'book-client',
    label: 'Book a client',
    icon: UserPlus,
    prompt: 'I want to book a new client appointment.',
  },
  {
    id: 'write-copy',
    label: 'Write copy',
    icon: Pencil,
    prompt: 'Write copy for a new post about my clinic.',
  },
  {
    id: 'performance-report',
    label: 'Performance Report',
    icon: ChartLine,
    prompt: 'Give me a performance report for my clinic this week.',
  },
];

const KEYBOARD_GAP_PX = 6;

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function conversationGroup(updated: Date): string {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (isSameDay(updated, now)) return 'Today';
  if (isSameDay(updated, yesterday)) return 'Yesterday';

  // Within the last 7 days → weekday + date label e.g. "Tuesday May 14th"
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  if (updated >= sevenDaysAgo) {
    return updated.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }
  return updated.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function groupConversations(
  conversations: ConversationSummary[]
): Array<{ label: string; items: ConversationSummary[] }> {
  const groups = new Map<string, ConversationSummary[]>();
  const order: string[] = [];
  for (const c of conversations) {
    const updated = new Date(c.updatedAt ?? c.createdAt);
    const label = conversationGroup(updated);
    if (!groups.has(label)) {
      groups.set(label, []);
      order.push(label);
    }
    groups.get(label)?.push(c);
  }
  return order.map((label) => ({
    label,
    items: groups.get(label) ?? [],
  }));
}

interface CircleIconButtonProps {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}

function CircleIconButton({ label, onClick, children }: CircleIconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-xs transition active:scale-[0.97]"
    >
      {children}
    </button>
  );
}

interface LauncherViewProps {
  onSendPrompt: (prompt: string) => void;
  onClose: () => void;
  onOpenHistory: () => void;
}

function LauncherView({
  onSendPrompt,
  onClose,
  onOpenHistory,
}: LauncherViewProps) {
  const [value, setValue] = useState('');
  const isEmpty = value.trim().length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-3">
        <CircleIconButton label="Chat history" onClick={onOpenHistory}>
          <History className="size-4" strokeWidth={2} />
        </CircleIconButton>
        <CircleIconButton label="Close" onClick={onClose}>
          <X className="size-4" strokeWidth={2} />
        </CircleIconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-4">
        <div className="mb-5 flex flex-col gap-1">
          <h2 className="text-2xl font-semibold text-foreground">
            How can I help you?
          </h2>
          <p className="text-sm text-muted-foreground">
            Ask Claire anything related to your clinic
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Suggestions
          </p>
          {CHIPS.map((chip) => {
            const Icon = chip.icon;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => onSendPrompt(chip.prompt)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3',
                  'text-left text-sm font-medium text-foreground shadow-xs transition-colors active:bg-accent'
                )}
              >
                <Icon
                  className="size-4 shrink-0 text-muted-foreground"
                  strokeWidth={2}
                />
                <span className="flex-1">{chip.label}</span>
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground"
                  strokeWidth={2}
                />
              </button>
            );
          })}
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-background px-4 pt-3 pb-2">
        <div className="flex flex-col rounded-2xl border border-border bg-card shadow-xs">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!isEmpty) onSendPrompt(value);
              }
            }}
            placeholder="Ask Claire anything..."
            className="w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
            rows={2}
          />
          <div className="flex items-center justify-end px-2 pb-2">
            <button
              type="button"
              disabled={isEmpty}
              onClick={() => onSendPrompt(value)}
              aria-label="Send"
              className={cn(
                'flex size-9 items-center justify-center rounded-full text-white transition',
                isEmpty
                  ? 'bg-muted text-muted-foreground'
                  : 'bg-[#155DFC] hover:bg-[#1248c7] active:scale-[0.97]'
              )}
            >
              <ArrowUp className="size-4" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ChatViewProps {
  conversationId?: string;
  initialDraft?: string;
  autoSend: boolean;
  chatKey: number;
  onConversationCreated: (id: string) => void;
  onClose: () => void;
  onOpenHistory: () => void;
}

function ChatView({
  conversationId,
  initialDraft,
  autoSend,
  chatKey,
  onConversationCreated,
  onClose,
  onOpenHistory,
}: ChatViewProps) {
  const { usage, isLoading: usageLoading } = useAssistantUsage();

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-row items-center justify-between px-4 pb-2 pt-2">
        <CircleIconButton label="Chat history" onClick={onOpenHistory}>
          <History className="size-4" strokeWidth={2} />
        </CircleIconButton>
        <div className="flex flex-col items-center gap-1">
          <span className="flex size-9 items-center justify-center rounded-full bg-[#155DFC] text-white shadow-[0_4px_10px_rgba(21,93,252,0.3)]">
            <Sparkles className="size-4" strokeWidth={2.4} />
          </span>
          <span className="text-xs font-medium text-foreground">Claire AI</span>
        </div>
        <CircleIconButton label="Close" onClick={onClose}>
          <X className="size-4" strokeWidth={2} />
        </CircleIconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4">
        {usageLoading ? (
          <ChatSkeleton />
        ) : usage && !usage.hasAccess ? (
          <div className="min-h-0 flex-1 overflow-y-auto bg-background py-3">
            <FreeTierGate />
          </div>
        ) : (
          <ChatContainer
            key={conversationId ?? `new-${chatKey}`}
            conversationId={conversationId}
            initialDraft={initialDraft}
            autoSend={autoSend}
            onConversationCreated={onConversationCreated}
            onBack={onClose}
          />
        )}
      </div>
    </div>
  );
}

interface HistoryViewProps {
  activeConversationId?: string;
  onBack: () => void;
  onClose: () => void;
  onSelectConversation: (id: string) => void;
}

function HistoryView({
  activeConversationId,
  onBack,
  onClose,
  onSelectConversation,
}: HistoryViewProps) {
  const [search, setSearch] = useState('');
  const { conversations, isLoading } = useConversations();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) =>
      (c.title ?? '').toLowerCase().includes(q)
    );
  }, [conversations, search]);

  const groups = useMemo(() => groupConversations(filtered), [filtered]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 pt-2 pb-4">
      <div className="flex shrink-0 items-center justify-between gap-3 pb-3">
        <CircleIconButton label="Back" onClick={onBack}>
          <ArrowLeft className="size-4" strokeWidth={2} />
        </CircleIconButton>
        <CircleIconButton label="Close" onClick={onClose}>
          <X className="size-4" strokeWidth={2} />
        </CircleIconButton>
      </div>

      <div className="flex flex-col gap-1 pb-4">
        <h2 className="text-2xl font-semibold text-foreground">Chat History</h2>
        <p className="text-sm text-muted-foreground">
          View and continue past conversations with Claire AI
        </p>
      </div>

      <div className="pb-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            strokeWidth={2}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chat history..."
            className="h-10 w-full rounded-full border border-border bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#155DFC]/30"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex flex-col gap-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No conversations yet.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map((group) => (
              <div key={group.label} className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </p>
                <div className="flex flex-col gap-2">
                  {group.items.map((c) => {
                    const active = c.id === activeConversationId;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => onSelectConversation(c.id)}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left shadow-xs transition active:bg-accent',
                          active && 'border-[#155DFC]/60'
                        )}
                      >
                        <span className="min-w-0 truncate text-sm font-medium text-foreground">
                          {c.title?.trim() || 'New chat'}
                        </span>
                        <ChevronRight
                          className="size-4 shrink-0 text-muted-foreground"
                          strokeWidth={2}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Claire modal — a self-contained sheet with three views:
 *  - `launcher` — chip prompts + free-text composer (entry view)
 *  - `chat`     — full chat conversation with the AI (after a prompt is sent
 *                 or a history item is opened)
 *  - `history`  — searchable, grouped list of past conversations
 *
 * Everything lives inside the modal — selecting a chip never navigates away
 * to `/assistant`; instead the sheet switches its view to `chat` and the
 * conversation auto-sends.
 */
export function MobileAskAiLauncherSheet({
  open,
  onOpenChange,
}: MobileAskAiLauncherSheetProps) {
  const keyboardInset = useVisualViewportKeyboardInset();
  const [view, setView] = useState<SheetView>('launcher');
  const [conversationId, setConversationId] = useState<string | undefined>(
    undefined
  );
  const [initialDraft, setInitialDraft] = useState<string | undefined>(
    undefined
  );
  const [autoSend, setAutoSend] = useState(false);
  const [chatKey, setChatKey] = useState(0);

  // Reset to the launcher view each time the sheet closes so the next open
  // starts fresh. The active conversation id is intentionally preserved across
  // re-opens — re-opening returns the user to their most recent chat.
  useEffect(() => {
    if (!open) {
      setView('launcher');
      setInitialDraft(undefined);
      setAutoSend(false);
    }
  }, [open]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const handleSendPrompt = useCallback((prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    setConversationId(undefined);
    setInitialDraft(trimmed);
    setAutoSend(true);
    setChatKey((k) => k + 1);
    setView('chat');
  }, []);

  const handleConversationCreated = useCallback((id: string) => {
    setConversationId(id);
  }, []);

  const handleSelectConversation = useCallback((id: string) => {
    setConversationId(id);
    setInitialDraft(undefined);
    setAutoSend(false);
    setChatKey((k) => k + 1);
    setView('chat');
  }, []);

  const keyboardBottomPad =
    keyboardInset > 0 ? keyboardInset + 12 + KEYBOARD_GAP_PX : undefined;

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[100] bg-black/40" />
        <Drawer.Content
          className="fixed inset-x-0 bottom-0 z-[100] flex h-[94dvh] flex-col overflow-hidden rounded-t-[22px] border-t border-border bg-background pb-[max(16px,env(safe-area-inset-bottom,0px))] pt-2.5 shadow-[0_-4px_14px_rgba(0,0,0,0.1)] outline-none"
          style={
            keyboardBottomPad !== undefined
              ? { paddingBottom: keyboardBottomPad }
              : undefined
          }
        >
          <Drawer.Title className="sr-only">Ask Claire</Drawer.Title>

          <div className="flex shrink-0 flex-col items-center pt-0.5 pb-1">
            <div
              className="h-1 w-8 shrink-0 rounded-full bg-muted-foreground/30"
              aria-hidden
            />
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <div
              className={cn(
                'flex min-h-0 flex-1 flex-col transition-transform duration-300 ease-out',
                view === 'history' && 'translate-x-4 opacity-0'
              )}
            >
              {view === 'launcher' && (
                <LauncherView
                  onSendPrompt={handleSendPrompt}
                  onClose={close}
                  onOpenHistory={() => setView('history')}
                />
              )}

              {view === 'chat' && (
                <ChatView
                  conversationId={conversationId}
                  initialDraft={initialDraft}
                  autoSend={autoSend}
                  chatKey={chatKey}
                  onConversationCreated={handleConversationCreated}
                  onClose={close}
                  onOpenHistory={() => setView('history')}
                />
              )}
            </div>

            <div
              className={cn(
                'absolute inset-0 flex flex-col bg-background transition-transform duration-300 ease-out',
                view === 'history' ? 'translate-x-0' : '-translate-x-full'
              )}
              aria-hidden={view !== 'history'}
            >
              <HistoryView
                activeConversationId={conversationId}
                onBack={() => setView(conversationId ? 'chat' : 'launcher')}
                onClose={close}
                onSelectConversation={handleSelectConversation}
              />
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
