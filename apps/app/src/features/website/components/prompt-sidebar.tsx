import {
  AlertCircle,
  ArrowUp,
  Loader2,
  ShieldAlert,
  Square,
  Wand2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import type { TranscriptEntry } from '../api/types';
import { DiffCard } from './diff-card';

const QUICK_ACTIONS = [
  'Add an about page',
  'Make it feel more premium',
  'Write a better headline for the homepage',
  'Add a section for our opening hours',
];

interface PromptSidebarProps {
  entries: TranscriptEntry[];
  isStreaming: boolean;
  /** Label of the block the canvas has selected, if any. */
  selectionLabel: string | null;
  onClearSelection: () => void;
  onSend: (prompt: string) => void;
  onStop: () => void;
  onUndo: (entry: TranscriptEntry) => void;
  onKeep: (entry: TranscriptEntry) => void;
  /** Approve a turn that stopped on a blocking confirmation. */
  onConfirm?: (entry: TranscriptEntry) => void;
  /** Decline it — nothing is sent. */
  onDecline?: (entry: TranscriptEntry) => void;
  isBusy?: boolean;
  disabled?: boolean;
}

/**
 * The prompt sidebar: transcript, activity lines, diff cards, composer.
 *
 * The transcript is a polite live region — a streaming answer that a screen
 * reader never announces is, for that user, the same silent failure as no
 * answer at all.
 */
export function PromptSidebar({
  entries,
  isStreaming,
  selectionLabel,
  onClearSelection,
  onSend,
  onStop,
  onUndo,
  onKeep,
  onConfirm,
  onDecline,
  isBusy,
  disabled,
}: PromptSidebarProps) {
  const [value, setValue] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Pin to the bottom as the turn streams in. Derived from the transcript
  // rather than the array identity so biome can see why the effect re-runs.
  const transcriptLength = entries.reduce(
    (total, entry) => total + entry.text.length + entry.activities.length,
    entries.length
  );
  useEffect(() => {
    const node = scrollRef.current;
    if (node && transcriptLength >= 0) node.scrollTop = node.scrollHeight;
  }, [transcriptLength]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming || disabled) return;
    onSend(trimmed);
    setValue('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col border-r bg-background">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Edit with a prompt</h2>
        <p className="text-xs text-muted-foreground">
          Changes land in your draft. Nothing goes live until you publish.
        </p>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
        aria-live="polite"
        aria-busy={isStreaming}
        aria-label="Conversation transcript"
      >
        {entries.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Describe what you want and the assistant edits your website. Try
              one of these:
            </p>
            <div className="flex flex-wrap gap-2">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action}
                  type="button"
                  disabled={disabled || isStreaming}
                  onClick={() => onSend(action)}
                  className="rounded-full border px-3 py-1.5 text-xs transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <Wand2 className="mr-1 inline size-3" aria-hidden />
                  {action}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {entries.map((entry) => (
          <TranscriptTurn
            key={entry.id}
            entry={entry}
            onUndo={() => onUndo(entry)}
            onKeep={() => onKeep(entry)}
            onConfirm={onConfirm ? () => onConfirm(entry) : undefined}
            onDecline={onDecline ? () => onDecline(entry) : undefined}
            isBusy={isBusy}
          />
        ))}
      </div>

      <div className="border-t p-3">
        {selectionLabel ? (
          <div className="mb-2 flex items-center gap-2 text-xs">
            <Badge variant="secondary" className="max-w-[70%] truncate">
              Editing: {selectionLabel}
            </Badge>
            <button
              type="button"
              onClick={onClearSelection}
              className="text-muted-foreground underline-offset-2 hover:underline"
            >
              Clear
            </button>
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <Textarea
            value={value}
            disabled={disabled}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={2}
            aria-label="Describe a change to your website"
            placeholder={
              selectionLabel
                ? `Change the ${selectionLabel} section…`
                : 'Describe a change…'
            }
            className="min-h-[56px] resize-none"
          />
          {isStreaming ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={onStop}
              aria-label="Stop generating"
            >
              <Square className="size-4" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              onClick={submit}
              disabled={!value.trim() || disabled}
              aria-label="Send"
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function TranscriptTurn({
  entry,
  onUndo,
  onKeep,
  onConfirm,
  onDecline,
  isBusy,
}: {
  entry: TranscriptEntry;
  onUndo: () => void;
  onKeep: () => void;
  onConfirm?: () => void;
  onDecline?: () => void;
  isBusy?: boolean;
}) {
  if (entry.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
          {entry.text}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {entry.activities.length > 0 ? (
        <ul className="space-y-1">
          {entry.activities.map((activity) => (
            <li
              key={activity.id}
              className={cn(
                'flex items-start gap-2 text-xs',
                activity.error ? 'text-destructive' : 'text-muted-foreground'
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'mt-1.5 size-1.5 shrink-0 rounded-full',
                  activity.error ? 'bg-destructive' : 'bg-muted-foreground/60'
                )}
              />
              <span>
                {activity.summary}
                {activity.error ? ` — failed: ${activity.error}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {entry.text ? (
        <p className="whitespace-pre-wrap text-sm">{entry.text}</p>
      ) : null}

      {entry.status === 'streaming' ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          Working on it…
        </p>
      ) : null}

      {entry.status === 'refused' && entry.error ? (
        <div
          role="status"
          className="flex gap-2 rounded-lg border border-amber-500/60 bg-amber-500/5 p-3 text-sm"
        >
          <ShieldAlert
            className="mt-0.5 size-4 shrink-0 text-amber-600"
            aria-hidden
          />
          <div>
            <p className="font-medium">{refusalTitle(entry.error.code)}</p>
            <p className="text-xs text-muted-foreground">
              {entry.error.message}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your draft was not changed. Try a smaller step, or edit the
              section directly in the inspector.
            </p>
          </div>
        </div>
      ) : null}

      {entry.status === 'error' && entry.error ? (
        <div
          role="alert"
          className="flex gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm"
        >
          <AlertCircle
            className="mt-0.5 size-4 shrink-0 text-destructive"
            aria-hidden
          />
          <div>
            <p className="font-medium">That turn did not finish</p>
            <p className="text-xs text-muted-foreground">
              {entry.error.message}
            </p>
          </div>
        </div>
      ) : null}

      {entry.diff || (entry.pendingConfirmations?.length ?? 0) > 0 ? (
        <DiffCard
          entry={entry}
          onUndo={onUndo}
          onKeep={onKeep}
          onConfirm={onConfirm}
          onDecline={onDecline}
          isBusy={isBusy}
        />
      ) : null}
    </div>
  );
}

function refusalTitle(code?: string): string {
  switch (code) {
    case 'tool_limit':
      return 'That was too big for one turn';
    case 'token_limit':
      return 'That turn ran too long';
    case 'spend_cap':
      return 'AI editing is paused for this month';
    default:
      return 'The assistant stopped short';
  }
}
