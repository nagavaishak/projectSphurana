import { History, Loader2, RotateCcw } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';

import type { MicrositeRevisionSummary } from '../api/types';

interface VersionHistoryProps {
  revisions: MicrositeRevisionSummary[];
  isLoading: boolean;
  isError: boolean;
  onRestore: (revisionId: string) => void;
  isRestoring: boolean;
  restoringId: string | null;
}

/**
 * Version history: every revision, what caused it, and one click back to it.
 *
 * "Which one is live" and "which one is the draft" come from the API's
 * `isPublished` / `isDraft` flags — never inferred from list position, which is
 * wrong the moment someone restores an older revision and the newest row stops
 * being the current draft.
 *
 * Restoring is confirmed, because it rewrites the draft (pages AND theme) in
 * one move. It is not destructive in the deeper sense — nothing is deleted and
 * the stack still holds everything — but it is surprising enough to deserve a
 * yes.
 */
export function VersionHistory({
  revisions,
  isLoading,
  isError,
  onRestore,
  isRestoring,
  restoringId,
}: VersionHistoryProps) {
  const [pending, setPending] = useState<MicrositeRevisionSummary | null>(null);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <History className="size-4" />
          History
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Version history</SheetTitle>
          <SheetDescription>
            Every change is a version. Restoring one rewrites your draft — it
            does not publish anything.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : isError ? (
            <p role="alert" className="text-sm text-destructive">
              Could not load your version history.
            </p>
          ) : revisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No versions yet. Your first change creates one.
            </p>
          ) : (
            <ol className="space-y-2">
              {revisions.map((revision) => (
                <li key={revision.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {revision.label ?? 'Change'}
                      </p>
                      {revision.prompt ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          “{revision.prompt}”
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {authorLabel(revision.createdBy)} ·{' '}
                        {formatWhen(revision.createdAt)}
                      </p>
                      <div className="mt-1 flex gap-1">
                        {revision.isDraft ? (
                          <Badge variant="secondary">Current draft</Badge>
                        ) : null}
                        {revision.isPublished ? (
                          <Badge variant="outline">Live</Badge>
                        ) : null}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={isRestoring || revision.isDraft}
                      onClick={() => setPending(revision)}
                    >
                      {isRestoring && restoringId === revision.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RotateCcw className="size-4" />
                      )}
                      Restore
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </SheetContent>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this version?</AlertDialogTitle>
            <AlertDialogDescription>
              Your draft — sections and theme — goes back to “
              {pending?.label ?? 'this version'}”. Nothing is deleted, and your
              live site does not change until you publish.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) onRestore(pending.id);
                setPending(null);
              }}
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

function authorLabel(author: MicrositeRevisionSummary['createdBy']): string {
  if (author === 'agent') return 'Assistant';
  if (author === 'user') return 'Manual edit';
  return 'System';
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
