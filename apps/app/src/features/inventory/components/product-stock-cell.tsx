/**
 * Shows a product's total on-hand quantity (summed across locations) in the
 * products list. Only tracked products are queried; untracked products render
 * a muted dash.
 */

import { Badge } from '@/components/ui/badge';
import { useGetProductStock } from '../api';

interface ProductStockCellProps {
  productId: string;
  trackStock: boolean;
  lowStockLevel: number | null;
}

export function ProductStockCell({
  productId,
  trackStock,
  lowStockLevel,
}: ProductStockCellProps) {
  const { stock, isLoading } = useGetProductStock(trackStock ? productId : '');

  if (!trackStock) {
    return <span className="text-muted-foreground text-sm">Not tracked</span>;
  }
  if (isLoading) {
    return <span className="text-muted-foreground text-sm">…</span>;
  }

  const total = stock.reduce((sum, row) => sum + row.quantity, 0);
  const isLow = lowStockLevel != null && total <= lowStockLevel;

  return (
    <Badge variant={isLow ? 'destructive' : 'secondary'}>
      {total} in stock
    </Badge>
  );
}
