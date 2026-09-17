import { Button } from '@/components/ui/button';
import type { SaleWithRelations } from '@borradh-workspace/api-client/types';
import { salePaymentMethodLabels } from '@borradh-workspace/api-client/types';
import { CheckCircle2Icon, GiftIcon } from 'lucide-react';
import { formatMoney } from '../../lib/money';

interface ReceiptSummaryProps {
  sale: SaleWithRelations;
  onNewSale: () => void;
  onDone: () => void;
}

/** Receipt-style confirmation shown after a sale is completed. */
export function ReceiptSummary({
  sale,
  onNewSale,
  onDone,
}: ReceiptSummaryProps) {
  const currency = sale.currency;
  const giftCardLines = sale.items.filter((i) => i.itemType === 'gift_card');

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div className="flex flex-col items-center gap-2 text-center">
        <CheckCircle2Icon className="size-12 text-green-600 dark:text-green-400" />
        <h2 className="text-xl font-semibold">Sale complete</h2>
        <p className="text-sm text-muted-foreground">
          {formatMoney(sale.totalCents, currency)} collected
        </p>
      </div>

      <div className="rounded-lg border p-4">
        <ul className="divide-y">
          {sale.items.map((item) => (
            <li key={item.id} className="flex justify-between py-2 text-sm">
              <span>
                {item.quantity} × {item.name}
              </span>
              <span className="font-medium">
                {formatMoney(item.totalCents, currency)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-2 space-y-1 border-t pt-2 text-sm">
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
          <div className="flex justify-between font-semibold">
            <span>Total</span>
            <span>{formatMoney(sale.totalCents, currency)}</span>
          </div>
        </div>
      </div>

      {sale.payments.length > 0 && (
        <div className="rounded-lg border p-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Payments
          </p>
          <ul className="space-y-1 text-sm">
            {sale.payments.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>{salePaymentMethodLabels[p.method]}</span>
                <span>{formatMoney(p.amountCents, currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {giftCardLines.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          <GiftIcon className="size-4" />
          {giftCardLines.length} gift card
          {giftCardLines.length > 1 ? 's' : ''} issued.
        </div>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={onDone}
        >
          Done
        </Button>
        <Button type="button" className="flex-1" onClick={onNewSale}>
          New sale
        </Button>
      </div>
    </div>
  );
}
