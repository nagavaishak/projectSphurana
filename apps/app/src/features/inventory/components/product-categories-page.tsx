import type { ProductCategory } from '@borradh-workspace/api-client/types';
import { FolderTree, MoreHorizontal } from 'lucide-react';
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

import { useDeleteProductCategory, useListProductCategories } from '../api';
import { ProductCategoryDialog } from './product-category-dialog';

type DialogState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; category: ProductCategory };

/**
 * Product categories, on the shared `ListPage`.
 *
 * A category is a name and nothing else, so the phone row is just the name:
 * there is no `secondary` and deliberately no `trailing` — a made-up trailing
 * value would be worse than none.
 *
 * Edited in a dialog (two-field form), so a row click opens that dialog rather
 * than the unified `/edit/:entity/:id` editor.
 */
export function ProductCategoriesPage() {
  const { categories, isLoading, isError, error } = useListProductCategories();
  const { deleteProductCategory, isDeleting } = useDeleteProductCategory();

  const [dialog, setDialog] = useState<DialogState>({ kind: 'closed' });
  const [deleteTarget, setDeleteTarget] = useState<ProductCategory | null>(
    null
  );

  const openEdit = (category: ProductCategory) =>
    setDialog({ category, kind: 'edit' });

  const columns: ListColumn<ProductCategory>[] = [
    {
      cell: (category) => <span className="font-medium">{category.name}</span>,
      header: 'Name',
      id: 'name',
      mobile: 'primary',
    },
  ];

  return (
    <>
      <title>Product categories | Borradh</title>

      <ListPage<ProductCategory>
        config={{
          columns,
          empty: {
            description:
              'Add a category to organize the products you sell and use.',
            icon: FolderTree,
            title: 'No categories yet',
          },
          errorMessage: error?.message ?? 'Failed to load categories',
          isError,
          isLoading,
          primaryAction: {
            label: 'Add category',
            mobileLabel: 'Add',
            onClick: () => setDialog({ kind: 'create' }),
          },
          rowActions: (category) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={`Actions for ${category.name}`}
                  size="icon"
                  variant="ghost"
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEdit(category)}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setDeleteTarget(category)}
                  variant="destructive"
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
          rowKey: (category) => category.id,
          onRowClick: openEdit,
          rows: categories,
          title: 'Product categories',
        }}
      />

      <ProductCategoryDialog
        category={dialog.kind === 'edit' ? dialog.category : null}
        onOpenChange={(open) => {
          if (!open) setDialog({ kind: 'closed' });
        }}
        open={dialog.kind !== 'closed'}
      />

      <ConfirmDeleteDialog
        description="This removes the category. Products that reference it will no longer show a category."
        isPending={isDeleting}
        onConfirm={() => {
          if (deleteTarget) deleteProductCategory(deleteTarget.id);
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
