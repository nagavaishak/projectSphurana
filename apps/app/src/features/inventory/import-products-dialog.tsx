'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { ImportFromLocationDialog } from '@/components/app/import-from-location';
import type { ImportFromLocationRow } from '@/components/app/import-from-location';
import { useActiveLocation } from '@/features/organization-locations';
import { useOrgCurrency } from '@/hooks/use-org-currency';

import { useAddProductLocations, useListProducts } from './api';

/**
 * "Import from another location…" for products.
 *
 * The adapter: it turns products into rows and a selection into writes, and
 * knows nothing about how the dialog looks. Sibling of
 * `ImportServicesDialog` — the shell is shared so the five catalogue pages
 * cannot drift into five different import experiences.
 *
 * The list already carries `locationIds`, so "available at Cork but not here"
 * is a filter over data the page has, not a second endpoint. EMPTY
 * `locationIds` MEANS EVERY BRANCH — such a record is already available here
 * and is never a candidate.
 */
export function ImportProductsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { location: active, locations } = useActiveLocation();
  const { products, isLoading, isError, error, refetch } = useListProducts({
    limit: 100,
  });
  const { format } = useOrgCurrency();

  const sourceLocations = useMemo(
    () => locations.filter((l) => l.id !== active?.id).map(toOption),
    [locations, active?.id]
  );

  // NOT `useState(sourceLocations[0]?.id)`: lazy initial state is evaluated on
  // the first render, while the locations are still loading.
  const [chosenLocationId, setChosenLocationId] = useState<string | null>(null);
  const sourceLocationId = chosenLocationId ?? sourceLocations[0]?.id ?? null;

  const { addProductLocationsAsync, isAdding } = useAddProductLocations();

  const rows: ImportFromLocationRow[] = useMemo(() => {
    if (!(sourceLocationId && active)) return [];

    return products
      .filter((product) =>
        (product.locationIds ?? []).includes(sourceLocationId)
      )
      .map((product) => ({
        id: product.id,
        name: product.name,
        meta: product.skus?.[0] ?? undefined,
        trailing:
          product.retailEnabled && product.retailPriceCents != null
            ? format(product.retailPriceCents)
            : undefined,
        alreadyHere: (product.locationIds ?? []).includes(active.id),
      }));
  }, [products, sourceLocationId, active, format]);

  const handleImport = async (ids: string[]) => {
    if (!active) return;

    // One request per record: the endpoint is per-resource, and a partial
    // failure should leave the successful copies in place.
    const results = await Promise.allSettled(
      ids.map((id) =>
        addProductLocationsAsync({ productId: id, locationIds: [active.id] })
      )
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    const added = ids.length - failed;
    const where = active.name ?? 'this location';

    if (added > 0) {
      toast.success(
        added === 1
          ? `1 product added to ${where}`
          : `${added} products added to ${where}`
      );
    }
    // Each failure already toasted; this is the count, so a partial success is
    // never read as a full one.
    if (failed > 0) {
      toast.error(`${failed} could not be imported`);
    }

    if (added > 0) onOpenChange(false);
  };

  return (
    <ImportFromLocationDialog
      entityPlural="products"
      errorMessage={error?.message}
      isError={isError}
      isImporting={isAdding}
      isLoading={isLoading}
      onImport={handleImport}
      onOpenChange={onOpenChange}
      onRetry={() => refetch()}
      onSourceLocationChange={setChosenLocationId}
      open={open}
      rows={rows}
      sourceLocationId={sourceLocationId}
      sourceLocations={sourceLocations}
      targetLocationName={active?.name ?? 'this location'}
      title="Import products"
    />
  );
}

/** A branch's display name — falls back to its address, as the switcher does. */
function toOption(location: {
  id: string;
  name: string | null;
  addressLine1: string;
}) {
  return { id: location.id, name: location.name ?? location.addressLine1 };
}
