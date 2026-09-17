import { Brain } from 'lucide-react';
import { useState } from 'react';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';

import { useDeleteMemory } from '../api/use-delete-memory';
import { useEditMemory } from '../api/use-edit-memory';
import type { MemoryListItem } from '../api/use-memories';
import { useMemories } from '../api/use-memories';

import { MemoryEditDialog } from './memory-edit-dialog';
import { MemoryRow } from './memory-row';

/**
 * Memories list — fetches via `useMemories`, renders rows + an edit
 * dialog + a delete confirmation. Used by the
 * `/settings/claire/memories` page.
 *
 * Optimistic updates live in the hooks (`useEditMemory` /
 * `useDeleteMemory`); this component is presentation-only.
 */
export function MemoriesList() {
  const { items, isLoading, isError } = useMemories({ type: 'preference' });

  const [editTarget, setEditTarget] = useState<MemoryListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MemoryListItem | null>(null);

  const { editMemory, isEditing } = useEditMemory({
    onSuccess: () => setEditTarget(null),
  });
  const { deleteMemory, isDeleting } = useDeleteMemory({
    onSuccess: () => setDeleteTarget(null),
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load memories</AlertTitle>
        <AlertDescription>
          Try refreshing in a moment. If the problem keeps up, drop us a line.
        </AlertDescription>
      </Alert>
    );
  }

  if (items.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Brain />
          </EmptyMedia>
          <EmptyTitle>Nothing remembered yet</EmptyTitle>
          <EmptyDescription>
            Tell Claire in chat — &ldquo;Claire, remember that…&rdquo; — and
            anything stable about you or your business will land here.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent />
      </Empty>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {items.map((memory) => (
          <MemoryRow
            key={memory.id}
            memory={memory}
            onEdit={setEditTarget}
            onDelete={setDeleteTarget}
            isBusy={
              (isEditing && editTarget?.id === memory.id) ||
              (isDeleting && deleteTarget?.id === memory.id)
            }
          />
        ))}
      </div>

      <MemoryEditDialog
        memory={editTarget}
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        onSave={editMemory}
        isSaving={isEditing}
      />

      <ConfirmDeleteDialog
        description="Claire will stop using it in chat. You can’t undo this."
        isPending={isDeleting}
        onConfirm={() => {
          if (deleteTarget) deleteMemory(deleteTarget.id);
        }}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        open={deleteTarget !== null}
        title="Delete this memory?"
      />
    </>
  );
}
