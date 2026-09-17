import { Globe, Loader2 } from 'lucide-react';
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

interface PublishButtonProps {
  changesSincePublish: number;
  hasEverPublished: boolean;
  isPublishing: boolean;
  onPublish: () => void;
  disabled?: boolean;
}

/**
 * Publish — the only thing that puts the draft in front of the public.
 *
 * The count is `changesSincePublish` from the API, rendered verbatim. It is
 * DIRECTIONAL (§1 amendment): it counts unpublished work AHEAD of live, so 0
 * means "nothing new to publish", NOT "the draft matches the live site" — a
 * draft restored to behind the published revision also reads 0. The copy is
 * worded to claim only the former; there is no signal for "your draft is behind
 * what is published", so the UI does not claim one and does not try to derive
 * it by diffing documents.
 */
export function PublishButton({
  changesSincePublish,
  hasEverPublished,
  isPublishing,
  onPublish,
  disabled,
}: PublishButtonProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const count = Math.max(0, changesSincePublish);

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {count > 0
            ? `${count} ${count === 1 ? 'change' : 'changes'} since last publish`
            : hasEverPublished
              ? 'No new changes to publish'
              : 'Not published yet'}
        </span>
        <Button
          type="button"
          size="sm"
          disabled={disabled || isPublishing}
          onClick={() => setConfirmOpen(true)}
        >
          {isPublishing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Globe className="size-4" />
          )}
          Publish
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish your website?</AlertDialogTitle>
            <AlertDialogDescription>
              Your current draft becomes the live site that visitors see.
              {count > 0
                ? ` It includes ${count} ${count === 1 ? 'change' : 'changes'} you have not published yet.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                onPublish();
              }}
            >
              Publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
