import type { Supplier } from '@borradh-workspace/api-client/types';
import { Factory, MoreHorizontal } from 'lucide-react';
import { useState } from 'react';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { ListPage } from '@/components/app/list-page';
import type { ListColumn } from '@/components/app/list-page';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { useDeleteSupplier, useListSuppliers } from '../api';
import { SupplierDialog } from './supplier-dialog';

type DialogState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; supplier: Supplier };

/**
 * Suppliers, on the shared `ListPage`.
 *
 * A supplier is a two-field record, so it is edited in a dialog rather than the
 * unified `/edit/:entity/:id` editor — a row click opens that dialog.
 */
export function SuppliersPage() {
  const { suppliers, isLoading, isError, error } = useListSuppliers();
  const { deleteSupplier, isDeleting } = useDeleteSupplier();

  const [dialog, setDialog] = useState<DialogState>({ kind: 'closed' });
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);

  const openEdit = (supplier: Supplier) =>
    setDialog({ kind: 'edit', supplier });

  const columns: ListColumn<Supplier>[] = [
    {
      cell: (supplier) => <span className="font-medium">{supplier.name}</span>,
      header: 'Name',
      id: 'name',
      mobile: 'primary',
    },
    {
      cell: (supplier) => (
        <span className="block max-w-md truncate text-muted-foreground">
          {supplier.description || '—'}
        </span>
      ),
      header: 'Description',
      id: 'description',
      mobile: 'secondary',
    },
  ];

  return (
    <>
      <title>Suppliers | Borradh</title>

      <ListPage<Supplier>
        config={{
          columns,
          empty: {
            description:
              'Add a supplier to reference on products and stock orders.',
            icon: Factory,
            title: 'No suppliers yet',
          },
          errorMessage: error?.message ?? 'Failed to load suppliers',
          isError,
          isLoading,
          primaryAction: {
            label: 'Add supplier',
            mobileLabel: 'Add',
            onClick: () => setDialog({ kind: 'create' }),
          },
          rowActions: (supplier) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={`Actions for ${supplier.name}`}
                  size="icon"
                  variant="ghost"
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEdit(supplier)}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setDeleteTarget(supplier)}
                  variant="destructive"
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
          rowKey: (supplier) => supplier.id,
          onRowClick: openEdit,
          rows: suppliers,
          title: 'Suppliers',
        }}
      />

      <SupplierDialog
        onOpenChange={(open) => {
          if (!open) setDialog({ kind: 'closed' });
        }}
        open={dialog.kind !== 'closed'}
        supplier={dialog.kind === 'edit' ? dialog.supplier : null}
      />

      <ConfirmDeleteDialog
        description="This removes the supplier. Products and stock orders that reference it will no longer show a supplier."
        isPending={isDeleting}
        onConfirm={() => {
          if (deleteTarget) deleteSupplier(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        open={!!deleteTarget}
        title={<>Delete &ldquo;{deleteTarget?.name}&rdquo;?</>}
      />
    </>
  );
}
