import type { ListedProduct } from '@borradh-workspace/api-client/types';
import { useNavigate } from '@tanstack/react-router';
import { MoreHorizontal, Package } from 'lucide-react';
import { useEffect, useState } from 'react';

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
import {
  isSharedAcrossBranches,
  useActiveLocation,
} from '@/features/organization-locations';
import { useOrgCurrency } from '@/hooks/use-org-currency';
import { ImportProductsDialog } from '../import-products-dialog';

import {
  useDeleteProduct,
  useListProductBrands,
  useListProducts,
  useRemoveProductLocation,
} from '../api';
import { ProductStockCell } from './product-stock-cell';

/**
 * Products, on the shared `ListPage`.
 *
 * The one list with a `media` column: the thumbnail is its own column so the
 * phone can render it as the row's leading image from the SAME config the table
 * uses, instead of the hand-written `ProductsMobileList` that used to sit beside
 * this file.
 *
 * Search is SERVER-side (debounced `?search=`), so it stays here — the shell
 * only owns the input, per the list-page rules.
 */
export function ProductsPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { products, isLoading, isError, error } = useListProducts({
    search: debouncedSearch || undefined,
  });
  const { brands } = useListProductBrands();
  const {
    location: activeLocation,
    locations,
    isMultiLocation,
  } = useActiveLocation();
  const { removeProductLocationAsync, isRemoving } = useRemoveProductLocation();
  const [importOpen, setImportOpen] = useState(false);
  const { deleteProduct, isDeleting } = useDeleteProduct();
  const { format } = useOrgCurrency();

  const navigate = useNavigate();
  // Create and edit are pages now (the shared `/create/:entity` editor), not a
  // dialog — see features/entity-editors.
  const openCreate = () =>
    void navigate({ params: { entity: 'product' }, to: '/create/$entity' });
  const openEdit = (product: ListedProduct) =>
    void navigate({
      params: { entity: 'product', id: product.id },
      to: '/edit/$entity/$id',
    });

  // `ListedProduct`: the delete prompt needs the row's `locationIds` to know
  // whether it is withdrawing from one branch or all of them.
  const [deleteTarget, setDeleteTarget] = useState<ListedProduct | null>(null);
  const sharedAcrossBranches = isSharedAcrossBranches({
    locationIds: deleteTarget?.locationIds,
    totalBranches: locations.length,
  });
  const branchLabel =
    activeLocation?.name ?? activeLocation?.addressLine1 ?? 'this location';

  const brandName = (id: string | null) =>
    id ? (brands.find((b) => b.id === id)?.name ?? '—') : '—';

  const columns: ListColumn<ListedProduct>[] = [
    {
      cell: (product) =>
        product.images?.[0] ? (
          <img
            alt=""
            className="size-9 rounded-md border object-cover"
            src={product.images[0]}
          />
        ) : (
          <div className="flex size-9 items-center justify-center rounded-md border bg-muted text-muted-foreground">
            <Package className="size-4" />
          </div>
        ),
      id: 'thumbnail',
      mobile: 'media',
      width: 'w-14',
    },
    {
      cell: (product) => (
        <div>
          <div className="font-medium">{product.name}</div>
          {product.skus?.[0] && (
            // Desktop only: on the phone the SKU rides in the `secondary` line
            // beside the brand, so it is not repeated here. `md:block` alone
            // does NOT hide it — it needs `hidden` first.
            <div className="hidden text-muted-foreground text-xs md:block">
              {product.skus[0]}
            </div>
          )}
        </div>
      ),
      header: 'Name',
      id: 'name',
      mobile: 'primary',
    },
    {
      cell: (product) => brandName(product.brandId),
      header: 'Brand',
      id: 'brand',
      mobile: 'secondary',
    },
    {
      align: 'right',
      cell: (product) => (
        <span className="font-medium">
          {product.retailEnabled && product.retailPriceCents != null
            ? format(product.retailPriceCents)
            : '—'}
        </span>
      ),
      header: 'Retail',
      id: 'retail',
      mobile: 'trailing',
    },
    {
      cell: (product) => (
        <ProductStockCell
          lowStockLevel={product.lowStockLevel}
          productId={product.id}
          trackStock={product.trackStock}
        />
      ),
      header: 'Stock',
      id: 'stock',
    },
  ];

  return (
    <>
      <title>Products | Borradh</title>

      <ListPage<ListedProduct>
        config={{
          columns,
          empty: {
            // "No matching products" is a search result, not an empty catalog,
            // so it gets NO call to action. An explicit empty node overrides the
            // shell's default of falling back to the primary action.
            action: debouncedSearch ? <span /> : undefined,
            description: debouncedSearch
              ? 'Try a different search term.'
              : 'Add your first product to start tracking stock and retail.',
            icon: Package,
            title: debouncedSearch ? 'No matching products' : 'No products yet',
          },
          errorMessage: error?.message ?? 'Failed to load products',
          isError,
          isLoading,
          primaryAction: {
            label: 'Add product',
            mobileLabel: 'Add',
            onClick: openCreate,
            // The caret only exists where there is somewhere to import FROM.
            // A single-location org would get a menu whose second item can
            // never do anything.
            menu: isMultiLocation
              ? {
                  items: [
                    { label: 'New product', onSelect: openCreate },
                    {
                      label: 'Import from another location…',
                      onSelect: () => setImportOpen(true),
                    },
                  ],
                }
              : undefined,
          },
          rowActions: (product) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={`Actions for ${product.name}`}
                  size="icon"
                  variant="ghost"
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEdit(product)}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setDeleteTarget(product)}
                  variant="destructive"
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
          rowKey: (product) => product.id,
          onRowClick: openEdit,
          rows: products,
          search,
          searchPlaceholder: 'Search products…',
          onSearchChange: setSearch,
          title: 'Products',
        }}
      />

      <ImportProductsDialog onOpenChange={setImportOpen} open={importOpen} />

      <ConfirmDeleteDialog
        confirmLabel={sharedAcrossBranches ? 'Delete everywhere' : 'Delete'}
        description={
          sharedAcrossBranches
            ? 'This product is stocked at other locations too. Removing it here takes it off this location only; deleting withdraws it from every location. Past stock orders and stocktakes keep working either way.'
            : 'The product is deactivated so any past stock orders and stocktakes that reference it keep working. It will no longer appear in the catalog or be available for new sales.'
        }
        isPending={isDeleting || isRemoving}
        onConfirm={() => {
          if (deleteTarget) deleteProduct(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        open={!!deleteTarget}
        secondaryAction={
          sharedAcrossBranches && activeLocation
            ? {
                label: `Remove from ${branchLabel}`,
                onClick: () => {
                  if (!deleteTarget) return;
                  const target = deleteTarget;
                  setDeleteTarget(null);
                  void removeProductLocationAsync({
                    productId: target.id,
                    locationId: activeLocation.id,
                  }).catch(() => undefined);
                },
              }
            : undefined
        }
        title={<>Delete &ldquo;{deleteTarget?.name}&rdquo;?</>}
      />
    </>
  );
}
