/**
 * Count view for a stocktake: each product shows its expected (snapshot)
 * quantity next to an inline counted-quantity input and the resulting variance.
 * Saving records the counts; completing writes counted quantities into product
 * stock as absolute values. Also supports cancelling.
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
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  useCancelStockTake,
  useCompleteStockTake,
  useGetStockTake,
  useListProducts,
  useRecordStockTakeCounts,
} from '../api';
import { StockTakeStatusBadge } from './status-badges';

interface StockTakeCountDialogProps {
  stockTakeId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function StockTakeCountDialog({
  stockTakeId,
  onOpenChange,
}: StockTakeCountDialogProps) {
  const open = !!stockTakeId;
  const { stockTake, isLoading } = useGetStockTake(stockTakeId ?? '');
  const { products } = useListProducts({ limit: 100 });
  const { recordStockTakeCountsAsync, isRecording } =
    useRecordStockTakeCounts();
  const { completeStockTake, isCompleting } = useCompleteStockTake();
  const { cancelStockTake, isCancelling } = useCancelStockTake();

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [confirmCancel, setConfirmCancel] = useState(false);

  const productName = (id: string) =>
    products.find((p) => p.id === id)?.name ?? 'Product';

  const isEditable = stockTake?.status === 'in_progress';

  // biome-ignore lint/correctness/useExhaustiveDependencies: seed on load
  useEffect(() => {
    if (stockTake) {
      const next: Record<string, string> = {};
      for (const item of stockTake.items) {
        next[item.id] =
          item.countedQuantity == null ? '' : String(item.countedQuantity);
      }
      setDrafts(next);
    }
  }, [stockTake?.id]);

  const saveCounts = async () => {
    if (!stockTake) return;
    // Pass raw drafts as intent; buildRecordStockTakeCountsPayload parses and
    // drops invalid rows. Skip the request when nothing valid was entered.
    const itemDrafts = stockTake.items.map((item) => ({
      itemId: item.id,
      rawCount: drafts[item.id] ?? '',
    }));
    const anyValid = itemDrafts.some((d) => {
      const n = Number.parseInt(d.rawCount, 10);
      return Number.isInteger(n) && n >= 0;
    });
    if (!anyValid) return;
    await recordStockTakeCountsAsync({ stockTakeId: stockTake.id, itemDrafts });
  };

  const handleComplete = async () => {
    if (!stockTake) return;
    // Persist any pending counts before completing.
    try {
      await saveCounts();
    } catch {
      return;
    }
    completeStockTake(stockTake.id, {
      onSuccess: () => onOpenChange(false),
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {stockTake?.name || 'Stocktake'}
              {stockTake && <StockTakeStatusBadge status={stockTake.status} />}
            </DialogTitle>
          </DialogHeader>

          {isLoading || !stockTake ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Expected</TableHead>
                    <TableHead className="text-right">Counted</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stockTake.items.map((item) => {
                    const draft = drafts[item.id] ?? '';
                    const counted =
                      draft === '' ? null : Number.parseInt(draft, 10);
                    const variance =
                      counted == null ? null : counted - item.expectedQuantity;
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          {productName(item.productId)}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.expectedQuantity}
                        </TableCell>
                        <TableCell className="text-right">
                          {isEditable ? (
                            <Input
                              type="number"
                              min={0}
                              className="ml-auto w-20"
                              value={draft}
                              onChange={(e) =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                              aria-label={`Count for ${productName(item.productId)}`}
                            />
                          ) : (
                            (item.countedQuantity ?? '—')
                          )}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right',
                            variance != null &&
                              variance < 0 &&
                              'text-destructive',
                            variance != null &&
                              variance > 0 &&
                              'text-green-600 dark:text-green-400'
                          )}
                        >
                          {variance == null
                            ? '—'
                            : variance > 0
                              ? `+${variance}`
                              : variance}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {isEditable && (
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmCancel(true)}
                disabled={isCancelling}
              >
                Cancel stocktake
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={saveCounts}
                disabled={isRecording}
              >
                {isRecording && <Loader2 className="size-4 animate-spin" />}
                Save counts
              </Button>
              <Button
                type="button"
                onClick={handleComplete}
                disabled={isCompleting || isRecording}
              >
                {isCompleting && <Loader2 className="size-4 animate-spin" />}
                Complete
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        cancelLabel="Keep counting"
        confirmLabel="Cancel stocktake"
        description="The stocktake is discarded and no stock levels are changed."
        isPending={isCancelling}
        onConfirm={() => {
          if (stockTake)
            cancelStockTake(stockTake.id, {
              onSuccess: () => onOpenChange(false),
            });
          setConfirmCancel(false);
        }}
        onOpenChange={setConfirmCancel}
        open={confirmCancel}
        title="Cancel this stocktake?"
      />
    </>
  );
}
