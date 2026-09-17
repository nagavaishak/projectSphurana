import { createFileRoute } from '@tanstack/react-router';
import { Loader2, Trash2 } from 'lucide-react';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { PageShell } from '@/components/app/page-shell';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  useDeleteCurrentBatch,
  useGetCurrentBatch,
} from '@/features/content-batches';

export const Route = createFileRoute('/_authed/dashboard/reset')({
  component: ResetPage,
});

function ResetPage() {
  const { batch, items, isLoading } = useGetCurrentBatch();
  const { resetBulkContent, isResetting } = useDeleteCurrentBatch();

  const hasBatch = batch != null;

  return (
    <>
      <title>Reset Bulk Content | Borradh</title>
      <PageShell maxWidth="max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle>Reset bulk content</CardTitle>
            <CardDescription>
              Clear this month's content batch so you can generate a new one.
              Your generated graphics, videos, and any posts are kept — only the
              batch is removed. The planner's Bulk Create button unlocks again
              once it's cleared.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {isLoading
                ? 'Checking for a current batch…'
                : hasBatch
                  ? `Current batch: ${batch.periodMonth} · status "${batch.status}" · ${items.length} item${items.length === 1 ? '' : 's'}.`
                  : 'No batch this month — nothing to reset.'}
            </p>
          </CardContent>
          <CardFooter>
            <ConfirmDeleteDialog
              confirmLabel="Delete batch"
              description="This removes the batch so you can generate a new one. Your generated graphics, videos, and posts are kept — they stay in your library."
              isPending={isResetting}
              onConfirm={() => resetBulkContent()}
              title="Clear this month’s batch?"
              trigger={
                <Button
                  disabled={!hasBatch || isResetting}
                  variant="destructive"
                >
                  {isResetting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                  Reset bulk content
                </Button>
              }
            />
          </CardFooter>
        </Card>
      </PageShell>
    </>
  );
}
