'use client';

import { Trash2Icon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

/**
 * The one destructive confirmation.
 *
 * Every "are you sure you want to delete this" in the app renders from here, so
 * they cannot drift in wording, layout, button order or button colour. Before
 * this there were 43 hand-assembled `AlertDialog`s plus 8 raw `window.confirm`
 * calls — the latter being unstyled, unbranded, and impossible to test.
 *
 * Shape is shadcn's `AlertDialogDestructive`: a tinted icon medallion, a
 * question for a title, the consequence as the description, then Cancel /
 * Delete with the destructive colour on the action.
 *
 * Controlled by default (`open` + `onOpenChange`), because almost every caller
 * already tracks *which* record is being deleted. Pass `trigger` instead for the
 * simple uncontrolled case.
 */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  secondaryAction,
  icon: Icon = Trash2Icon,
  isPending = false,
  onConfirm,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Uncontrolled use: the element that opens the dialog. */
  trigger?: ReactNode;
  /**
   * Phrase as a QUESTION naming the record — "Delete “Gold membership”?".
   * A generic "Are you sure?" makes the operator check what they clicked.
   */
  title: ReactNode;
  /**
   * What actually happens, especially anything irreversible or surprising
   * (deactivated instead of deleted, related records kept, etc).
   */
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * A SAFER alternative offered beside the destructive one — "Remove from this
   * location" next to "Delete everywhere".
   *
   * It exists because the branch redesign made one record reachable from
   * several pages: deleting a service from the Cork page takes it off Dublin's
   * booking page too, and the operator standing on Cork's page rarely means
   * that. Two labelled buttons make the SCOPE the thing you choose, rather than
   * something you infer from which page you were on.
   */
  secondaryAction?: { label: string; onClick: () => void };
  icon?: LucideIcon;
  isPending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive dark:bg-destructive/20">
            <Icon />
          </AlertDialogMedia>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {/*
          THREE actions do not fit a `max-w-sm` dialog side by side: the
          buttons are `whitespace-nowrap`, and "Remove from Rathmines Clinic"
          alone is wider than a third of 384px, so the row overflowed the panel.
          With a secondary action the footer stacks and each button takes the
          full width.

          `flex-col`, NOT the base `flex-col-reverse`: reversed puts the
          DESTRUCTIVE action at the top, nearest the pointer and read first.
          Plain column order runs Cancel → Remove here → Delete everywhere,
          which escalates downward and leaves the irreversible one last.
        */}
        <AlertDialogFooter
          className={cn(
            secondaryAction && 'flex-col gap-2 sm:flex-col sm:space-x-0'
          )}
        >
          <AlertDialogCancel
            className={cn(secondaryAction && 'w-full')}
            disabled={isPending}
            variant="outline"
          >
            {cancelLabel}
          </AlertDialogCancel>
          {/*
            Between Cancel and the destructive action, and NOT destructive-
            coloured: it is the option most operators want, and it reads as the
            middle of the three because it is.
          */}
          {secondaryAction && (
            <AlertDialogAction
              // `truncate` so a long branch name shortens instead of forcing
              // the panel wider than the viewport.
              className="w-full truncate"
              disabled={isPending}
              onClick={secondaryAction.onClick}
              variant="outline"
            >
              {secondaryAction.label}
            </AlertDialogAction>
          )}
          {/*
            Not wrapped in AlertDialogAction's default close-on-click only —
            Radix closes on activation, and `isPending` is here so a slow delete
            cannot be double-fired before the dialog unmounts.
          */}
          <AlertDialogAction
            className={cn(secondaryAction && 'w-full')}
            disabled={isPending}
            onClick={onConfirm}
            variant="destructive"
          >
            {isPending ? 'Deleting…' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
