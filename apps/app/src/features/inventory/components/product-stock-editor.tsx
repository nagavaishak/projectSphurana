/**
 * Per-location stock editor shown on the product form (edit mode) when stock
 * tracking is on. Each location shows the current quantity with an inline
 * input; saving sets the absolute quantity for that product/location.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useListLocations } from '@/features/organization-locations';
import { Check, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAdjustProductStock, useGetProductStock } from '../api';

interface ProductStockEditorProps {
  productId: string;
}

export function ProductStockEditor({ productId }: ProductStockEditorProps) {
  const { locations } = useListLocations();
  const { stock, isLoading } = useGetProductStock(productId);
  const { adjustProductStockAsync, isAdjusting } = useAdjustProductStock();

  // Draft quantity per locationId, seeded from the fetched stock rows.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const loc of locations) {
      const row = stock.find((s) => s.locationId === loc.id);
      next[loc.id] = String(row?.quantity ?? 0);
    }
    setDrafts(next);
  }, [stock, locations]);

  const save = async (locationId: string) => {
    const quantity = Number.parseInt(drafts[locationId] ?? '', 10);
    if (!Number.isInteger(quantity) || quantity < 0) return;
    setSavingId(locationId);
    try {
      await adjustProductStockAsync({ productId, locationId, quantity });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium text-sm">Current stock</p>
      {isLoading ? (
        <Skeleton className="h-9 w-full" />
      ) : locations.length === 0 ? (
        <p className="text-muted-foreground text-xs">No locations found.</p>
      ) : (
        locations.map((loc) => {
          const row = stock.find((s) => s.locationId === loc.id);
          const current = row?.quantity ?? 0;
          const draft = drafts[loc.id] ?? '';
          const dirty = draft !== String(current);
          return (
            <div key={loc.id} className="flex items-center gap-2">
              <span className="flex-1 truncate text-sm">
                {loc.name ?? 'Location'}
              </span>
              <Input
                type="number"
                min={0}
                className="w-24"
                value={draft}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, [loc.id]: e.target.value }))
                }
                aria-label={`Stock for ${loc.name ?? 'location'}`}
              />
              <Button
                type="button"
                size="icon"
                variant="outline"
                disabled={!dirty || isAdjusting}
                onClick={() => save(loc.id)}
                aria-label="Save stock"
              >
                {savingId === loc.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
              </Button>
            </div>
          );
        })
      )}
    </div>
  );
}
