import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { glassButtonClass } from '@/features/mobile-bottom-tabs/mobile-bottom-tabs-motion';
import { cn } from '@/lib/utils';
import { ArrowUp, Plus, Square } from 'lucide-react';
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
} from 'react';

const TEXTAREA_MIN_PX = 48;
const TEXTAREA_MAX_PX = 128;
const HEIGHT_TRANSITION = 'height 160ms cubic-bezier(0.32, 0.72, 0, 1)';

export interface AskAiMobileComposerProps {
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: (message: PromptInputMessage) => Promise<void> | void;
  onStop: () => void;
  status: 'submitted' | 'streaming' | 'ready' | 'error';
  placeholder: string;
  disabled?: boolean;
  submitDisabled?: boolean;
  onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onAttachClick: () => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
  isDragging?: boolean;
  dragOverlay?: React.ReactNode;
  attachments?: React.ReactNode;
  clipTray?: React.ReactNode;
  /** Fired when shell height changes (expand/collapse or textarea growth). */
  onLayoutChange?: () => void;
  /** Tighter inner padding (e.g. conversation thread without bottom tabs). */
  compactPadding?: boolean;
}

/**
 * Mobile Ask AI composer — glass pill (idle / waiting) expands while typing.
 * Shell shape/padding stay fixed; only inner layout and textarea height change.
 */
export function AskAiMobileComposer({
  draft,
  onDraftChange,
  onSubmit,
  onStop,
  status,
  placeholder,
  disabled = false,
  submitDisabled = false,
  onPaste,
  onAttachClick,
  onDragOver,
  onDragLeave,
  onDrop,
  isDragging = false,
  dragOverlay,
  attachments,
  clipTray,
  onLayoutChange,
  compactPadding = false,
}: AskAiMobileComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  const hasText = draft.trim().length > 0;
  const isWaiting = status === 'submitted' || status === 'streaming';
  const isExpanded = hasText && !isWaiting;

  const syncTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;

    if (!isExpanded) {
      el.style.transition = '';
      el.style.height = '';
      return;
    }

    el.style.transition = HEIGHT_TRANSITION;
    el.style.height = 'auto';
    const next = Math.min(
      Math.max(el.scrollHeight, TEXTAREA_MIN_PX),
      TEXTAREA_MAX_PX
    );
    el.style.height = `${next}px`;
  }, [isExpanded]);

  const notifyLayoutChange = useCallback(() => {
    onLayoutChange?.();
    requestAnimationFrame(() => onLayoutChange?.());
  }, [onLayoutChange]);

  const submit = useCallback(async () => {
    if (submitDisabled) return;
    await onSubmit({ text: draft, files: [] });
  }, [draft, onSubmit, submitDisabled]);

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isWaiting) {
      onStop();
      return;
    }
    void submit();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isExpanded) {
      e.preventDefault();
      if (!isWaiting) void submit();
    }
  };

  useEffect(() => {
    syncTextareaHeight();
    notifyLayoutChange();
  }, [syncTextareaHeight, notifyLayoutChange]);

  useEffect(() => {
    const el = shellRef.current;
    if (!el || !onLayoutChange) return;
    const observer = new ResizeObserver(() => onLayoutChange());
    observer.observe(el);
    return () => observer.disconnect();
  }, [onLayoutChange]);

  return (
    <form onSubmit={handleFormSubmit} className="w-full">
      {clipTray}
      {attachments}

      <div
        className={cn(
          'overflow-visible px-1 pt-0.5',
          compactPadding ? 'pb-1' : 'pb-2.5'
        )}
      >
        <div
          ref={shellRef}
          className={cn(
            glassButtonClass,
            // glassButtonClass carries the floating tab-bar drop shadow
            // (0 10px 32px) — too heavy here, it haloes when the composer
            // sits just above the keyboard. Soften to a contained lift.
            'shadow-[0_2px_10px_rgba(0,0,0,0.08)]',
            'relative w-full rounded-[30px] px-2 py-2',
            !isExpanded && 'min-h-[52px]',
            isDragging && 'ring-2 ring-primary/40 ring-offset-2'
          )}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {isDragging && dragOverlay}

          <div
            className={cn(
              isExpanded ? 'flex flex-col' : 'flex items-center gap-1'
            )}
          >
            {!isExpanded ? (
              <button
                type="button"
                className="flex size-10 shrink-0 items-center justify-center rounded-full text-[#8E8E93] active:bg-black/5 disabled:opacity-40"
                aria-label="Add attachment"
                disabled={disabled}
                onClick={onAttachClick}
              >
                <Plus className="size-5" strokeWidth={2} />
              </button>
            ) : null}

            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => {
                onDraftChange(e.target.value);
                requestAnimationFrame(syncTextareaHeight);
              }}
              onPaste={onPaste}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              rows={1}
              className={cn(
                'w-full resize-none px-2 border-0 bg-transparent text-[16px] tracking-[-0.2px] text-black outline-none placeholder:text-[#8E8E93] disabled:opacity-50',
                isExpanded
                  ? 'max-h-[60px] min-h-[60px] py-1 leading-[1.45]'
                  : 'max-h-11 min-h-0 flex-1 overflow-hidden py-2 leading-5'
              )}
              aria-label={placeholder}
            />

            {!isExpanded ? (
              <MobileComposerActionButton
                isWaiting={isWaiting}
                disabled={submitDisabled && !isWaiting}
                onStop={onStop}
              />
            ) : null}
          </div>

          {isExpanded ? (
            <div className="mt-2 flex items-center justify-between">
              <button
                type="button"
                className="flex size-9 items-center justify-center rounded-full text-[#8E8E93] active:bg-black/5 disabled:opacity-40"
                aria-label="Add attachment"
                disabled={disabled}
                onClick={onAttachClick}
              >
                <Plus className="size-5" strokeWidth={2} />
              </button>
              <MobileComposerActionButton
                isWaiting={isWaiting}
                disabled={submitDisabled && !isWaiting}
                onStop={onStop}
              />
            </div>
          ) : null}
        </div>
      </div>
    </form>
  );
}

function MobileComposerActionButton({
  isWaiting,
  disabled,
  onStop,
}: {
  isWaiting: boolean;
  disabled?: boolean;
  onStop: () => void;
}) {
  if (isWaiting) {
    return (
      <button
        type="button"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#2E65F3] text-white active:scale-[0.97]"
        aria-label="Stop generating"
        onClick={onStop}
      >
        <Square className="size-3 fill-white text-white" strokeWidth={0} />
      </button>
    );
  }

  return (
    <button
      type="submit"
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-full text-white active:scale-[0.97] disabled:opacity-40',
        disabled ? 'bg-[#C7C7CC]' : 'bg-[#2E65F3]'
      )}
      aria-label="Send message"
      disabled={disabled}
    >
      <ArrowUp className="size-[18px]" strokeWidth={2.25} />
    </button>
  );
}
