import { createFileRoute } from '@tanstack/react-router';
import { CalendarOff, MoreVertical } from 'lucide-react';
import { useState } from 'react';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { ListPage } from '@/components/app/list-page';
import type { ListColumn } from '@/components/app/list-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  type BlockedTimeType,
  BlockedTimeTypeDialog,
  formatDurationMinutes,
  useDeleteBlockedTimeType,
  useListBlockedTimeTypes,
} from '@/features/scheduling';

export const Route = createFileRoute(
  '/_authed/dashboard/settings/blocked-time-types'
)({
  component: BlockedTimeTypesPage,
});

/**
 * Blocked time types, on the shared `ListPage`. Create and edit stay in
 * `BlockedTimeTypeDialog` — these presets have no unified-editor entity.
 */
function BlockedTimeTypesPage() {
  const { blockedTimeTypes, isLoading, isError, error } =
    useListBlockedTimeTypes();
  const { deleteBlockedTimeType, isDeleting } = useDeleteBlockedTimeType();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BlockedTimeType | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BlockedTimeType | null>(
    null
  );

  const openAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (type: BlockedTimeType) => {
    setEditing(type);
    setDialogOpen(true);
  };

  const handleDelete = (type: BlockedTimeType) => setDeleteTarget(type);

  const columns: ListColumn<BlockedTimeType>[] = [
    {
      id: 'name',
      header: 'Name',
      mobile: 'primary',
      cell: (type) => <span className="font-medium">{type.name}</span>,
    },
    {
      id: 'duration',
      header: 'Default duration',
      mobile: 'secondary',
      cell: (type) => (
        <span className="text-muted-foreground">
          {formatDurationMinutes(type.durationMinutes)}
        </span>
      ),
    },
    {
      id: 'compensation',
      header: 'Compensation',
      mobile: 'trailing',
      cell: (type) => (
        <Badge variant={type.paid ? 'default' : 'secondary'}>
          {type.paid ? 'Paid' : 'Unpaid'}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <title>Blocked time types | Borradh</title>

      <ListPage<BlockedTimeType>
        config={{
          title: 'Blocked time types',
          columns,
          rows: blockedTimeTypes,
          rowKey: (type) => type.id,
          onRowClick: openEdit,
          rowActions: (type) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="size-7" size="icon" variant="ghost">
                  <span className="sr-only">Open menu</span>
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEdit(type)}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleDelete(type)}
                  variant="destructive"
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
          primaryAction: {
            label: 'Add type',
            mobileLabel: 'Add',
            onClick: openAdd,
          },
          isLoading,
          isError,
          errorMessage: `Failed to load blocked time types: ${error?.message || 'Unknown error'}`,
          empty: {
            icon: CalendarOff,
            title: 'No blocked time types yet',
            description:
              'Reusable presets for blocking time on the calendar, like lunch or training. Create your first preset to block off time quickly.',
          },
        }}
      />

      <BlockedTimeTypeDialog
        blockedTimeType={editing}
        onOpenChange={setDialogOpen}
        open={dialogOpen}
      />

      <ConfirmDeleteDialog
        description="The preset is removed. Time already blocked on the calendar with it stays blocked."
        isPending={isDeleting}
        onConfirm={() => {
          if (deleteTarget) deleteBlockedTimeType(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        open={deleteTarget !== null}
        title={<>Delete the &ldquo;{deleteTarget?.name}&rdquo; type?</>}
      />
    </>
  );
}
