import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type {
  SaleItem,
  SaleWithRelations,
} from '@borradh-workspace/api-client/types';
import { saleItemTypeLabels } from '@borradh-workspace/api-client/types';
import {
  CheckIcon,
  Loader2Icon,
  PencilIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useState } from 'react';
import { formatMoney, toCents } from '../../lib/money';

interface CartSummaryProps {
  sale: SaleWithRelations;
  /** Disable removing / editing items (e.g. past the cart step). */
  readOnly?: boolean;
  removingItemId?: string | null;
  onRemoveItem?: (itemId: string) => void;
  /** Item currently being re-priced (remove + re-add in flight). */
  pricingItemId?: string | null;
  /** Override a line's unit price (operator-set). */
  onEditPrice?: (item: SaleItem, unitPriceCents: number) => void;
}

/** A single cart line with an inline, editable unit price. */
function CartLine({
  item,
  currency,
  readOnly,
  isRemoving,
  onRemoveItem,
  isPricing,
  onEditPrice,
}: {
  item: SaleItem;
  currency: string;
  readOnly?: boolean;
  isRemoving: boolean;
  onRemoveItem?: (itemId: string) => void;
  isPricing: boolean;
  onEditPrice?: (item: SaleItem, unitPriceCents: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const canEditPrice = !readOnly && !!onEditPrice;
  const needsPrice = item.unitPriceCents === 0;

  const startEditing = () => {
    setDraft((item.unitPriceCents / 100).toFixed(2));
    setEditing(true);
  };

  const commit = () => {
    const parsed = Number.parseFloat(draft);
    if (Number.isNaN(parsed) || parsed < 0) return;
    onEditPrice?.(item, toCents(parsed));
    setEditing(false);
  };

  return (
    <li className="flex items-start gap-2 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{item.name}</span>
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {saleItemTypeLabels[item.itemType]}
          </Badge>
        </div>

        {editing ? (
          <div className="mt-1 flex items-center gap-1">
            <Input
              type="number"
              min={0}
              step={0.01}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') setEditing(false);
              }}
              className="h-7 w-24 text-xs"
              aria-label={`Unit price for ${item.name}`}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              disabled={isPricing}
              onClick={commit}
              aria-label="Save price"
            >
              <CheckIcon className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-muted-foreground"
              onClick={() => setEditing(false)}
              aria-label="Cancel price edit"
            >
              <XIcon className="size-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <p className="text-xs text-muted-foreground">
              {item.itemType === 'gift_card' &&
              item.giftCardFaceValueCents != null &&
              item.giftCardFaceValueCents !== item.unitPriceCents
                ? `${formatMoney(item.giftCardFaceValueCents, currency)} value`
                : `${item.quantity} × ${formatMoney(item.unitPriceCents, currency)}`}
            </p>
            {canEditPrice && isPricing ? (
              <Loader2Icon className="size-3 animate-spin text-muted-foreground" />
            ) : canEditPrice && needsPrice ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={startEditing}
              >
                Set price
              </Button>
            ) : (
              canEditPrice && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0 text-muted-foreground"
                  onClick={startEditing}
                  aria-label={`Edit price for ${item.name}`}
                >
                  <PencilIcon className="size-3" />
                </Button>
              )
            )}
          </div>
        )}
      </div>

      <span className="shrink-0 text-sm font-semibold">
        {formatMoney(item.totalCents, currency)}
      </span>
      {!readOnly && onRemoveItem && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
          disabled={isRemoving}
          onClick={() => onRemoveItem(item.id)}
          aria-label={`Remove ${item.name}`}
        >
          <Trash2Icon className="size-4" />
        </Button>
      )}
    </li>
  );
}

/** The order summary: line items with totals for subtotal, tip and total. */
export function CartSummary({
  sale,
  readOnly,
  removingItemId,
  onRemoveItem,
  pricingItemId,
  onEditPrice,
}: CartSummaryProps) {
  const currency = sale.currency;

  return (
    <div className="flex flex-col gap-3">
      {sale.items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No items yet. Add a service, product, membership or gift card.
        </p>
      ) : (
        <ul className="divide-y">
          {sale.items.map((item) => (
            <CartLine
              key={item.id}
              item={item}
              currency={currency}
              readOnly={readOnly}
              isRemoving={removingItemId === item.id}
              onRemoveItem={onRemoveItem}
              isPricing={pricingItemId === item.id}
              onEditPrice={onEditPrice}
            />
          ))}
        </ul>
      )}

      <div className="space-y-1 border-t pt-3 text-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>Subtotal</span>
          <span>{formatMoney(sale.subtotalCents, currency)}</span>
        </div>
        {sale.tipCents > 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>Tip</span>
            <span>{formatMoney(sale.tipCents, currency)}</span>
          </div>
        )}
        <div className="flex justify-between text-base font-semibold">
          <span>Total</span>
          <span>{formatMoney(sale.totalCents, currency)}</span>
        </div>
      </div>
    </div>
  );
}
