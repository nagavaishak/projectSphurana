/** Status badge helpers for stock orders and stocktakes. */

import { Badge } from '@/components/ui/badge';
import type {
  StockOrderStatus,
  StockTakeStatus,
} from '@borradh-workspace/api-client/types';
import {
  stockOrderStatusLabels,
  stockTakeStatusLabels,
} from '@borradh-workspace/api-client/types';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

const stockOrderVariant: Record<StockOrderStatus, BadgeVariant> = {
  draft: 'outline',
  ordered: 'secondary',
  partially_received: 'default',
  received: 'default',
  cancelled: 'destructive',
};

export function StockOrderStatusBadge({
  status,
}: { status: StockOrderStatus }) {
  return (
    <Badge variant={stockOrderVariant[status]}>
      {stockOrderStatusLabels[status]}
    </Badge>
  );
}

const stockTakeVariant: Record<StockTakeStatus, BadgeVariant> = {
  in_progress: 'secondary',
  completed: 'default',
  cancelled: 'destructive',
};

export function StockTakeStatusBadge({ status }: { status: StockTakeStatus }) {
  return (
    <Badge variant={stockTakeVariant[status]}>
      {stockTakeStatusLabels[status]}
    </Badge>
  );
}
