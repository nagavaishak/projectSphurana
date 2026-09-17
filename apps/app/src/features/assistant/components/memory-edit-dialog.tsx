import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

import type { MemoryListItem } from '../api/use-memories';

export interface MemoryEditDialogProps {
  memory: MemoryListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: { id: string; content: string }) => void;
  isSaving?: boolean;
}

const MAX_CONTENT_LENGTH = 2000;

/**
 * Edit dialog for a single memory's content. Backed by `useEditMemory`.
 *
 * The dialog stays mounted while the edit is in flight (no spinner — the
 * Save button shows "Saving..." instead, mirroring the rest of the app).
 * On a successful save, the parent closes via `onOpenChange(false)`.
 *
 * Hard-block 400 errors come back from the server with a human-readable
 * message; the parent surfaces it via `toast.error` (handled in the hook).
 */
export function MemoryEditDialog({
  memory,
  open,
  onOpenChange,
  onSave,
  isSaving = false,
}: MemoryEditDialogProps) {
  const [content, setContent] = useState('');

  // Reset the textarea when the dialog opens with a new memory; not when
  // it closes (avoids the textarea blanking out mid-fade).
  useEffect(() => {
    if (open && memory) {
      setContent(memory.content);
    }
  }, [open, memory]);

  const isUnchanged = memory ? content.trim() === memory.content.trim() : true;
  const isInvalid = !content.trim() || content.length > MAX_CONTENT_LENGTH;

  const handleSave = () => {
    if (!memory || isInvalid || isSaving) return;
    onSave({ id: memory.id, content: content.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit memory</DialogTitle>
          <DialogDescription>
            Tweak what Claire remembers. She&apos;ll use the new wording in
            future chats.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What should Claire remember?"
            rows={5}
            maxLength={MAX_CONTENT_LENGTH}
            aria-invalid={isInvalid}
            disabled={isSaving}
          />
          <p className="text-muted-foreground text-xs">
            {content.length}/{MAX_CONTENT_LENGTH}
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isInvalid || isUnchanged || isSaving}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
