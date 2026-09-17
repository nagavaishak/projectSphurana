/**
 * Detail view for a stock order: line items with ordered / received / remaining
 * quantities, fees, and totals. Supports the receive flow (received quantities
 * are deltas per receipt event that increment product stock at the order's
 * destination) and cancelling the order.
 */

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useListLocations } from '@/features/organization-locations';
import { useOrgCurrency } from '@/hooks/use-org-currency';
import { stockOrderFeeTypeLabels } from '@borradh-workspace/api-client/types';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  useCancelStockOrder,
  useGetStockOrder,
  useListProducts,
  useReceiveStockOrder,
} from '../api';
import { StockOrderStatusBadge } from './status-badges';

interface StockOrderDetailDialogProps {
  stockOrderId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function StockOrderDetailDialog({
  stockOrderId,
  onOpenChange,
}: StockOrderDetailDialogProps) {
  const open = !!stockOrderId;
  const { stockOrder, isLoading } = useGetStockOrder(stockOrderId ?? '');
  const { products } = useListProducts({ limit: 100 });
  const { locations } = useListLocations();
  const { format } = useOrgCurrency();
  const { receiveStockOrderAsync, isReceiving } = useReceiveStockOrder();
  const { cancelStockOrder, isCancelling } = useCancelStockOrder();

  const [receiving, setReceiving] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [confirmCancel, setConfirmCancel] = useState(false);

  const productName = (id: string) =>
    products.find((p) => p.id === id)?.name ?? 'Product';

  // Seed receive drafts with each item's remaining quantity.
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed on enter receive mode
  useEffect(() => {
    if (receiving && stockOrder) {
      const next: Record<string, string> = {};
      for (const item of stockOrder.items) {
        next[item.id] = String(
          Math.max(0, item.quantity - item.receivedQuantity)
        );
      }
      setDrafts(next);
    }
  }, [receiving, stockOrder?.id]);

  const totals = useMemo(() => {
    if (!stockOrder) return { items: 0, fees: 0, total: 0 };
    const itemsTotal = stockOrder.items.reduce(
      (sum, i) => sum + i.quantity * i.unitCostCents,
      0
    );
    const feesTotal = stockOrder.fees.reduce((sum, fee) => {
      // percent fees stored as basis points against the items subtotal
      return fee.type === 'percent'
        ? sum + Math.round((itemsTotal * fee.value) / 10000)
        : sum + fee.value;
    }, 0);
    return {
      items: itemsTotal,
      fees: feesTotal,
      total: itemsTotal + feesTotal,
    };
  }, [stockOrder]);

  const canReceive =
    stockOrder != null &&
    stockOrder.status !== 'received' &&
    stockOrder.status !== 'cancelled';
  const canCancel =
    stockOrder != null &&
    stockOrder.status !== 'received' &&
    stockOrder.status !== 'cancelled';

  const handleReceive = async () => {
    if (!stockOrder) return;
    // Pass raw drafts as intent; buildReceiveStockOrderPayload parses and drops
    // zero rows. Skip the request when nothing positive was entered.
    const itemDrafts = stockOrder.items.map((item) => ({
      itemId: item.id,
      rawQuantity: drafts[item.id] ?? '0',
    }));
    const anyPositive = itemDrafts.some(
      (d) => (Number.parseInt(d.rawQuantity, 10) || 0) > 0
    );
    if (!anyPositive) {
      setReceiving(false);
      return;
    }
    try {
      await receiveStockOrderAsync({
        stockOrderId: stockOrder.id,
        itemDrafts,
      });
      setReceiving(false);
    } catch {
      // Hook already surfaces an error toast.
    }
  };

  const locationName = stockOrder?.locationId
    ? (locations.find((l) => l.id === stockOrder.locationId)?.name ??
      'Location')
    : null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              Stock order
              {stockOrder && (
                <StockOrderStatusBadge status={stockOrder.status} />
              )}
            </DialogTitle>
          </DialogHeader>

          {isLoading || !stockOrder ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {locationName && (
                  <div>
                    <span className="text-muted-foreground">Deliver to: </span>
                    {locationName}
                  </div>
                )}
                {stockOrder.expectedByDate && (
                  <div>
                    <span className="text-muted-foreground">Expected: </span>
                    {new Date(stockOrder.expectedByDate).toLocaleDateString()}
                  </div>
                )}
              </div>
              {stockOrder.notes && (
                <p className="text-muted-foreground text-sm">
                  {stockOrder.notes}
                </p>
              )}

              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Ordered</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      {receiving ? (
                        <TableHead className="text-right">
                          Receiving now
                        </TableHead>
                      ) : (
                        <TableHead className="text-right">Unit cost</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stockOrder.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          {productName(item.productId)}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.quantity}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.receivedQuantity}
                        </TableCell>
                        {receiving ? (
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min={0}
                              max={item.quantity - item.receivedQuantity}
                              className="ml-auto w-20"
                              value={drafts[item.id] ?? ''}
                              onChange={(e) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                              aria-label={`Receiving ${productName(item.productId)}`}
                            />
                          </TableCell>
                        ) : (
                          <TableCell className="text-right">
                            {format(item.unitCostCents)}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {stockOrder.fees.length > 0 && (
                <div className="flex flex-col gap-1 text-sm">
                  {stockOrder.fees.map((fee) => (
                    <div key={fee.id} className="flex justify-between">
                      <span className="text-muted-foreground">
                        {fee.name} ({stockOrderFeeTypeLabels[fee.type]})
                      </span>
                      <span>
                        {fee.type === 'percent'
                          ? `${fee.value / 100}%`
                          : format(fee.value)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <Separator />
              <div className="flex flex-col gap-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Items subtotal</span>
                  <span>{format(totals.items)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fees</span>
                  <span>{format(totals.fees)}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>Total</span>
                  <span>{format(totals.total)}</span>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            {receiving ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setReceiving(false)}
                  disabled={isReceiving}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleReceive}
                  disabled={isReceiving}
                >
                  {isReceiving && <Loader2 className="size-4 animate-spin" />}
                  Confirm receipt
                </Button>
              </>
            ) : (
              <>
                {canCancel && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setConfirmCancel(true)}
                    disabled={isCancelling}
                  >
                    Cancel order
                  </Button>
                )}
                {canReceive && (
                  <Button type="button" onClick={() => setReceiving(true)}>
                    Receive delivery
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        cancelLabel="Keep order"
        confirmLabel="Cancel order"
        description="The order is marked cancelled. Stock already received stays in your inventory; nothing further will be received."
        isPending={isCancelling}
        onConfirm={() => {
          if (stockOrder) cancelStockOrder(stockOrder.id);
          setConfirmCancel(false);
        }}
        onOpenChange={setConfirmCancel}
        open={confirmCancel}
        title="Cancel this stock order?"
      />
    </>
  );
}
