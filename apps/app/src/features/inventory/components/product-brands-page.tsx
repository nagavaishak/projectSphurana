import type { ProductBrand } from '@borradh-workspace/api-client/types';
import { MoreHorizontal, Tag } from 'lucide-react';
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

import { useDeleteProductBrand, useListProductBrands } from '../api';
import { ProductBrandDialog } from './product-brand-dialog';

type DialogState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; brand: ProductBrand };

/**
 * Product brands, on the shared `ListPage`.
 *
 * The `useIsMobile` branch and `ProductBrandsMobileList` are gone: the desktop
 * table and the phone list render from the SAME column config below.
 *
 * A brand is a two-field record, so it is edited in a dialog rather than the
 * unified `/edit/:entity/:id` editor — a row click opens that dialog.
 */
export function ProductBrandsPage() {
  const { brands, isLoading, isError, error } = useListProductBrands();
  const { deleteProductBrand, isDeleting } = useDeleteProductBrand();

  const [dialog, setDialog] = useState<DialogState>({ kind: 'closed' });
  const [deleteTarget, setDeleteTarget] = useState<ProductBrand | null>(null);

  const openEdit = (brand: ProductBrand) => setDialog({ brand, kind: 'edit' });

  const columns: ListColumn<ProductBrand>[] = [
    {
      cell: (brand) => <span className="font-medium">{brand.name}</span>,
      header: 'Name',
      id: 'name',
      mobile: 'primary',
    },
    {
      cell: (brand) => (
        <span className="block max-w-md truncate text-muted-foreground">
          {brand.description || '—'}
        </span>
      ),
      header: 'Description',
      id: 'description',
      mobile: 'secondary',
    },
  ];

  return (
    <>
      <title>Product brands | Borradh</title>

      <ListPage<ProductBrand>
        config={{
          columns,
          empty: {
            description:
              'Add a brand to categorize the products you sell and use.',
            icon: Tag,
            title: 'No brands yet',
          },
          errorMessage: error?.message ?? 'Failed to load brands',
          isError,
          isLoading,
          primaryAction: {
            label: 'Add brand',
            mobileLabel: 'Add',
            onClick: () => setDialog({ kind: 'create' }),
          },
          rowActions: (brand) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={`Actions for ${brand.name}`}
                  size="icon"
                  variant="ghost"
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEdit(brand)}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setDeleteTarget(brand)}
                  variant="destructive"
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
          rowKey: (brand) => brand.id,
          onRowClick: openEdit,
          rows: brands,
          title: 'Product brands',
        }}
      />

      <ProductBrandDialog
        brand={dialog.kind === 'edit' ? dialog.brand : null}
        onOpenChange={(open) => {
          if (!open) setDialog({ kind: 'closed' });
        }}
        open={dialog.kind !== 'closed'}
      />

      <ConfirmDeleteDialog
        description="This removes the brand. Products that reference it will no longer show a brand."
        isPending={isDeleting}
        onConfirm={() => {
          if (deleteTarget) deleteProductBrand(deleteTarget.id);
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
