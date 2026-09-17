import { AlertTriangle, Check, Undo2 } from 'lucide-react';
import { useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { TranscriptEntry } from '../api/types';
import { describeDiff, isEmptyDiff } from '../lib/describe-diff';

interface DiffCardProps {
  entry: TranscriptEntry;
  onUndo: () => void;
  onKeep: () => void;
  /** Approve the blocked destructive action(s) — re-sends with `confirmedActions`. */
  onConfirm?: () => void;
  /** Decline. Sends nothing; the turn stays visibly not-done. */
  onDecline?: () => void;
  isBusy?: boolean;
}

/**
 * The end of a mutating turn: what changed, and the two things the user can do
 * about it.
 *
 * The summary line comes from the `done` event's `diff` and nothing else (§4).
 *
 * Destructive turns (§3 — `delete_page`, a theme brand change) are gated here
 * rather than trusted: Keep opens a confirmation first. Undo needs no
 * confirmation, because undo is the safe direction. If the user declines the
 * confirmation the change simply stays unconfirmed and Undo is still one click
 * away — nothing destructive is ever silently accepted.
 *
 * Confirmation is BLOCKING, not post-hoc. When the turn carries
 * `pendingConfirmations` the tool did not run at all: confirming re-sends the
 * same prompt with the action key in `confirmedActions` (the only thing the API
 * accepts), and declining sends nothing. The declined state is rendered
 * explicitly — a turn that silently ends is indistinguishable from a model that
 * ignored the request.
 */
export function DiffCard({
  entry,
  onUndo,
  onKeep,
  onConfirm,
  onDecline,
  isBusy,
}: DiffCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const diff = entry.diff;
  const pending = entry.pendingConfirmations ?? [];
  const awaiting = pending.length > 0 && entry.confirmationState === 'awaiting';
  const declined = pending.length > 0 && entry.confirmationState === 'declined';

  if (awaiting) {
    return (
      <div className="rounded-lg border border-amber-500/60 bg-amber-500/5 p-3 text-sm">
        <div className="flex items-start gap-2">
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-amber-600"
            aria-hidden
          />
          <div>
            <p className="font-medium">This needs your go-ahead</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {pending.map((item) => item.prompt).join(' ')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Nothing has changed yet — it only runs if you confirm.
            </p>
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isBusy}
            onClick={onDecline}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isBusy}
            onClick={() => setConfirmOpen(true)}
          >
            <Check className="size-3.5" />
            Confirm and run
          </Button>
        </div>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm this change</AlertDialogTitle>
              <AlertDialogDescription>
                {pending.map((item) => item.prompt).join(' ')} It stays in your
                draft until you publish, and you can undo it from version
                history.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={onDecline}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirmOpen(false);
                  onConfirm?.();
                }}
              >
                Yes, do it
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  if (declined) {
    return (
      <div role="status" className="rounded-lg border bg-muted/40 p-3 text-sm">
        <p className="font-medium">Not done</p>
        <p className="mt-1 text-xs text-muted-foreground">
          You cancelled, so nothing on your website changed. Ask again if you
          want it after all.
        </p>
      </div>
    );
  }

  if (!diff) return null;

  const destructive = entry.activities.filter((a) => a.requiresConfirmation);
  const needsConfirmation = destructive.length > 0;
  const decided = entry.decision !== undefined;

  return (
    <div
      className={cn(
        'rounded-lg border bg-muted/40 p-3 text-sm',
        needsConfirmation && !decided && 'border-amber-500/60 bg-amber-500/5'
      )}
    >
      <div className="flex items-start gap-2">
        {needsConfirmation && !decided ? (
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-amber-600"
            aria-hidden
          />
        ) : null}
        <p className="flex-1 font-medium">
          {isEmptyDiff(diff)
            ? 'Nothing on the site changed'
            : describeDiff(diff)}
        </p>
      </div>

      {needsConfirmation && !decided ? (
        <p className="mt-2 text-xs text-muted-foreground">
          This turn made a change that needs your confirmation:{' '}
          {destructive.map((a) => a.summary).join('; ')}.
        </p>
      ) : null}

      {decided ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {entry.decision === 'kept' ? 'Kept.' : 'Undone.'}
        </p>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onUndo}
            disabled={isBusy}
          >
            <Undo2 className="size-3.5" />
            Undo
          </Button>
          <Button
            type="button"
            size="sm"
            variant={needsConfirmation ? 'default' : 'secondary'}
            disabled={isBusy}
            onClick={() => {
              if (needsConfirmation) {
                setConfirmOpen(true);
                return;
              }
              onKeep();
            }}
          >
            <Check className="size-3.5" />
            {needsConfirmation ? 'Confirm and keep' : 'Keep'}
          </Button>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm this change</AlertDialogTitle>
            <AlertDialogDescription>
              {destructive.map((a) => a.summary).join('; ')}. This stays in your
              draft until you publish, and you can still undo it from version
              history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                onKeep();
              }}
            >
              Keep the change
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
