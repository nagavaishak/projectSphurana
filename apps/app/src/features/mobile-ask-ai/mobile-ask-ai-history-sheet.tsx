import { MobileBottomSheet } from '@/components/mobile-bottom-sheet';
import { format, isToday, isYesterday, startOfDay } from 'date-fns';
import { ChevronRight, Loader2, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import {
  type ConversationSummary,
  useConversations,
  useDeleteConversation,
} from '@/features/assistant';

const HISTORY_SHEET_Z_CLASS = 'z-[110]';
/** iOS grouped table background */
const HISTORY_BG = '#F2F2F7';
const LABEL_COLOR = '#8E8E93';
const DIVIDER_COLOR = '#E5E5EA';
const CARD_BORDER_COLOR = '#E5E5EA';
const SEARCH_FILL = '#E5E5EA';
const CLOSE_FILL = '#E5E5EA';

function toDate(value: ConversationSummary['updatedAt']): Date {
  return new Date(value as string | number | Date);
}

interface HistoryGroup {
  key: string;
  label: string;
  items: ConversationSummary[];
  order: number;
}

function groupConversationsByDate(
  conversations: ConversationSummary[]
): HistoryGroup[] {
  const map = new Map<string, HistoryGroup>();

  for (const c of conversations) {
    const d = toDate(c.updatedAt);
    let key: string;
    let label: string;
    let order: number;

    if (isToday(d)) {
      key = 'today';
      label = 'Today';
      order = 0;
    } else if (isYesterday(d)) {
      key = 'yesterday';
      label = 'Yesterday';
      order = 1;
    } else {
      const day = startOfDay(d);
      key = day.toISOString();
      label = format(d, 'EEEE MMMM do');
      order = 2;
    }

    const existing = map.get(key);
    if (existing) {
      existing.items.push(c);
    } else {
      map.set(key, { key, label, items: [c], order });
    }
  }

  const byRecent = (a: ConversationSummary, b: ConversationSummary) =>
    toDate(b.updatedAt).getTime() - toDate(a.updatedAt).getTime();

  return [...map.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort(byRecent),
    }))
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      const aDay = toDate(a.items[0]?.updatedAt ?? 0).getTime();
      const bDay = toDate(b.items[0]?.updatedAt ?? 0).getTime();
      return bDay - aDay;
    });
}

function useLongPress(onLongPress: () => void, delayMs = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = () => {
    clear();
    timerRef.current = setTimeout(onLongPress, delayMs);
  };

  useEffect(() => () => clear(), [clear]);

  return {
    onTouchStart: start,
    onTouchEnd: clear,
    onTouchMove: clear,
    onTouchCancel: clear,
    onMouseDown: start,
    onMouseUp: clear,
    onMouseLeave: clear,
  };
}

export interface MobileAskAiHistorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeConversationId?: string;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
}

/**
 * Chat history in its own stacked bottom sheet (above the Ask AI chat sheet).
 */
export function MobileAskAiHistorySheet({
  open,
  onOpenChange,
  activeConversationId,
  onSelectConversation,
  onNewChat,
}: MobileAskAiHistorySheetProps) {
  const handleClose = () => onOpenChange(false);

  return (
    <MobileBottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Chat History"
      keyboardAware
      zClass={HISTORY_SHEET_Z_CLASS}
      contentClassName="!border-t-0 !bg-[#F2F2F7] !pb-0 !shadow-none"
    >
      <MobileAskAiHistoryContent
        open={open}
        activeConversationId={activeConversationId}
        onSelectConversation={onSelectConversation}
        onNewChat={onNewChat}
        onClose={handleClose}
      />
    </MobileBottomSheet>
  );
}

interface MobileAskAiHistoryContentProps {
  open: boolean;
  activeConversationId?: string;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onClose: () => void;
}

function HistoryCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      className="flex size-10 shrink-0 items-center justify-center rounded-full transition active:opacity-80"
      style={{ backgroundColor: CLOSE_FILL }}
      aria-label="Close chat history"
      onClick={onClose}
    >
      <X className="size-[18px] text-[#3C3C43]" strokeWidth={2.25} />
    </button>
  );
}

function MobileAskAiHistoryContent({
  open,
  activeConversationId,
  onSelectConversation,
  onNewChat,
  onClose,
}: MobileAskAiHistoryContentProps) {
  const { conversations, isLoading } = useConversations();
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);

  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;

  const { deleteConversation, isDeleting } = useDeleteConversation();

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const deletedId = pendingDelete.id;
    deleteConversation(deletedId, {
      onSuccess: () => {
        if (deletedId === activeConversationIdRef.current) {
          onNewChat();
          onClose();
        }
        setPendingDelete(null);
      },
    });
  };

  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const filtered = useMemo(
    () =>
      conversations.filter((c) =>
        (c.title ?? '').toLowerCase().includes(search.trim().toLowerCase())
      ),
    [conversations, search]
  );

  const groups = useMemo(() => groupConversationsByDate(filtered), [filtered]);

  const handlePick = (id: string) => {
    onSelectConversation(id);
    onClose();
  };

  return (
    <>
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        style={{ backgroundColor: HISTORY_BG }}
      >
        <div className="shrink-0 px-5 pb-2 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 pr-2">
              <h1 className="text-[30px] font-bold leading-[1.1] tracking-[-0.4px] text-black">
                Chat History
              </h1>
              <p
                className="mt-2 max-w-[280px] text-[15px] font-normal leading-[1.35]"
                style={{ color: LABEL_COLOR }}
              >
                View and continue past conversations with Claire AI
              </p>
            </div>
            <HistoryCloseButton onClose={onClose} />
          </div>

          <label
            className="mt-5 flex h-11 items-center gap-2.5 rounded-xl px-3.5"
            style={{ backgroundColor: SEARCH_FILL }}
          >
            <Search
              className="size-[17px] shrink-0 text-[#8E8E93]"
              strokeWidth={2}
              aria-hidden
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chat history..."
              className="min-w-0 flex-1 border-0 bg-transparent py-0 text-[15px] text-black outline-none placeholder:text-[#8E8E93]"
              aria-label="Search chat history"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch] px-5 pb-6 pt-1">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2
                className="size-8 animate-spin text-[#2563EB]"
                aria-label="Loading"
              />
            </div>
          ) : groups.length === 0 ? (
            <p
              className="pt-10 text-center text-[15px] leading-snug"
              style={{ color: LABEL_COLOR }}
            >
              {search.trim()
                ? 'No chats match your search.'
                : 'No chat history yet.'}
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              {groups.map((group) => (
                <HistorySection
                  key={group.key}
                  label={group.label}
                  items={group.items}
                  onSelect={handlePick}
                  onRequestDelete={(id, title) =>
                    setPendingDelete({ id, title })
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmDeleteDialog
        description="The chat and every message in it are permanently deleted. This can’t be undone."
        isPending={isDeleting || !pendingDelete}
        onConfirm={confirmDelete}
        onOpenChange={(o) => {
          if (!o) setPendingDelete(null);
        }}
        open={pendingDelete !== null}
        title={<>Delete &ldquo;{pendingDelete?.title || 'Untitled'}&rdquo;?</>}
      />
    </>
  );
}

function HistorySection({
  label,
  items,
  onSelect,
  onRequestDelete,
}: {
  label: string;
  items: ConversationSummary[];
  onSelect: (id: string) => void;
  onRequestDelete: (id: string, title: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section>
      <h2
        className="mb-1.5 px-1 text-[13px] font-semibold tracking-[-0.1px]"
        style={{ color: LABEL_COLOR }}
      >
        {label}
      </h2>
      <div
        className="overflow-hidden rounded-[10px] border bg-white"
        style={{ borderColor: CARD_BORDER_COLOR }}
      >
        <ul>
          {items.map((c, index) => {
            const title = c.title || 'Untitled';
            return (
              <HistoryRow
                key={c.id}
                title={title}
                isLast={index === items.length - 1}
                onSelect={() => onSelect(c.id)}
                onRequestDelete={() => onRequestDelete(c.id, title)}
              />
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function HistoryRow({
  title,
  isLast,
  onSelect,
  onRequestDelete,
}: {
  title: string;
  isLast: boolean;
  onSelect: () => void;
  onRequestDelete: () => void;
}) {
  const longPress = useLongPress(onRequestDelete);

  return (
    <li>
      <button
        type="button"
        className="flex w-full min-h-[52px] items-center gap-2 py-4 pr-4 pl-4 text-left transition-colors active:bg-[#F2F2F7]"
        onClick={onSelect}
        {...longPress}
      >
        <span className="min-w-0 flex-1 truncate text-[15px] font-normal leading-snug tracking-[-0.2px] text-black">
          {title}
        </span>
        <ChevronRight
          className="size-4 shrink-0 text-[#C7C7CC]"
          strokeWidth={2.25}
          aria-hidden
        />
      </button>
      {!isLast ? (
        <div
          className="h-px w-full"
          style={{ backgroundColor: DIVIDER_COLOR }}
          aria-hidden
        />
      ) : null}
    </li>
  );
}
