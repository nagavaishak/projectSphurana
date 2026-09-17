import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  saleItemTypeLabels,
  salePaymentMethodLabels,
  salePaymentStatusLabels,
  saleStatusLabels,
} from '@borradh-workspace/api-client/types';
import type { SaleWithRelations } from '@borradh-workspace/api-client/types';

import { useVoidSale } from '../../api';
import { formatMoney } from '../../lib/money';

interface SaleDetailSheetProps {
  sale: SaleWithRelations | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SaleDetailSheet({
  sale,
  open,
  onOpenChange,
}: SaleDetailSheetProps) {
  const { voidSale, isVoiding } = useVoidSale(sale?.id ?? '', {
    onSuccess: () => onOpenChange(false),
  });

  // Void is only supported for an OPEN sale with no settled tender — the backend
  // (void-sale.service) rejects anything else ("a sale with settled payments
  // cannot be voided — refund it instead"). Offering it on a completed/settled
  // sale just fires a mutation that always errors, so gate the UI to match.
  const canVoid =
    !!sale &&
    sale.status === 'open' &&
    !sale.payments.some((p) => p.status === 'succeeded');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>Sale details</SheetTitle>
        </SheetHeader>

        {sale && (
          <div className="flex flex-1 flex-col gap-6 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <Badge variant="outline">{saleStatusLabels[sale.status]}</Badge>
            </div>

            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">Items</h3>
              <div className="flex flex-col gap-2">
                {sale.items.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No items on this sale.
                  </p>
                )}
                {sale.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start justify-between gap-2 text-sm"
                  >
                    <div>
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {saleItemTypeLabels[item.itemType]} · {item.quantity} ×{' '}
                        {formatMoney(item.unitPriceCents, sale.currency)}
                      </div>
                    </div>
                    <div className="whitespace-nowrap font-medium">
                      {formatMoney(item.totalCents, sale.currency)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">Payments</h3>
              <div className="flex flex-col gap-2">
                {sale.payments.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No payments recorded.
                  </p>
                )}
                {sale.payments.map((payment) => (
                  <div
                    key={payment.id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span>{salePaymentMethodLabels[payment.method]}</span>
                      <Badge variant="outline">
                        {salePaymentStatusLabels[payment.status]}
                      </Badge>
                    </div>
                    <div className="whitespace-nowrap font-medium">
                      {formatMoney(payment.amountCents, sale.currency)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1 border-t pt-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatMoney(sale.subtotalCents, sale.currency)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Tip</span>
                <span>{formatMoney(sale.tipCents, sale.currency)}</span>
              </div>
              <div className="flex items-center justify-between font-medium">
                <span>Total</span>
                <span>{formatMoney(sale.totalCents, sale.currency)}</span>
              </div>
            </div>

            {canVoid && (
              <ConfirmDeleteDialog
                confirmLabel="Void sale"
                description="This cannot be undone. The sale will be marked as void and excluded from totals."
                isPending={isVoiding}
                onConfirm={() => voidSale()}
                title="Void this sale?"
                trigger={
                  <Button
                    className="mt-auto"
                    disabled={isVoiding}
                    variant="destructive"
                  >
                    Void sale
                  </Button>
                }
              />
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
