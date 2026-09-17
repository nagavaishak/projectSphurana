import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useListServices } from '@/features/organization-services';
import type { AddSaleItemInput } from '@borradh-workspace/api-client/types';
import { formatServicePrice } from '@borradh-workspace/labels';
import { SearchIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useListMembershipPlans, useListProducts } from '../../api';
import { currencySymbol, formatMoney } from '../../lib/money';

export type CatalogMode = 'service' | 'product' | 'membership';

interface CatalogPickerDialogProps {
  mode: CatalogMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  onSelect: (input: AddSaleItemInput) => void;
}

interface NormalizedItem {
  id: string;
  name: string;
  priceCents: number;
  subtitle?: string;
}

const MODE_TITLE: Record<CatalogMode, string> = {
  service: 'Add a service',
  product: 'Add a product',
  membership: 'Add a membership',
};

/**
 * Searchable picker for the three catalog-backed cart line types. Each
 * selection is normalized into an `AddSaleItemInput` for the sale.
 */
export function CatalogPickerDialog({
  mode,
  open,
  onOpenChange,
  currency,
  onSelect,
}: CatalogPickerDialogProps) {
  const [search, setSearch] = useState('');

  const { services, isLoading: servicesLoading } = useListServices();
  const { products, isLoading: productsLoading } = useListProducts();
  const { plans, isLoading: plansLoading } = useListMembershipPlans();

  const isLoading =
    (mode === 'service' && servicesLoading) ||
    (mode === 'product' && productsLoading) ||
    (mode === 'membership' && plansLoading);

  const items: NormalizedItem[] = useMemo(() => {
    if (mode === 'service') {
      const symbol = currencySymbol(currency);
      return services.map((s) => ({
        id: s.id,
        name: s.name,
        // Structured price snapshot for the cart line — never parsed from text.
        priceCents: s.priceCents ?? 0,
        subtitle: formatServicePrice({
          priceType: s.priceType,
          priceCents: s.priceCents,
          currencySymbol: symbol,
        }),
      }));
    }
    if (mode === 'product') {
      return products
        .filter((p) => p.retailEnabled && p.isActive)
        .map((p) => ({
          id: p.id,
          name: p.name,
          priceCents: p.retailPriceCents ?? 0,
        }));
    }
    return plans
      .filter((p) => p.isActive)
      .map((p) => ({
        id: p.id,
        name: p.name,
        priceCents: p.priceCents,
      }));
  }, [mode, services, products, plans, currency]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.name.toLowerCase().includes(q));
  }, [items, search]);

  const handleSelect = (item: NormalizedItem) => {
    const base = {
      name: item.name,
      quantity: 1,
      unitPriceCents: item.priceCents,
    };
    let input: AddSaleItemInput;
    if (mode === 'service') {
      input = { ...base, itemType: 'service', serviceId: item.id };
    } else if (mode === 'product') {
      input = { ...base, itemType: 'product', productId: item.id };
    } else {
      input = { ...base, itemType: 'membership', membershipPlanId: item.id };
    }
    onSelect(input);
    onOpenChange(false);
    setSearch('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{MODE_TITLE[mode]}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nothing to add here yet.
            </p>
          ) : (
            filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item)}
                className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left hover:bg-accent"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  {item.subtitle && (
                    <p className="truncate text-xs text-muted-foreground">
                      {item.subtitle}
                    </p>
                  )}
                </div>
                <span className="ml-3 shrink-0 text-sm font-semibold">
                  {formatMoney(item.priceCents, currency)}
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
