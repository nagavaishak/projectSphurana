import { format } from 'date-fns';
import { ChevronRight, Receipt } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { SaleDetailSheet } from '@/features/sales/components/pages/sale-detail-sheet';
import {
  type SaleStatus,
  type SaleWithRelations,
  saleStatusLabels,
} from '@borradh-workspace/api-client/types';
import { useClientSales } from '../api';
import { formatMoney } from '../lib/format-money';

function saleStatusVariant(
  status: SaleStatus
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed':
      return 'default';
    case 'refunded':
    case 'partially_refunded':
    case 'voided':
      return 'destructive';
    default:
      return 'secondary';
  }
}

function SaleRow({
  sale,
  onSelect,
}: {
  sale: SaleWithRelations;
  onSelect: (sale: SaleWithRelations) => void;
}) {
  const itemCount = sale.items?.length ?? 0;
  return (
    // Open the shared sale-detail sheet inline (same component the sales list
    // uses). There is no sale-detail route to link to — detail is sheet-driven.
    <button
      type="button"
      onClick={() => onSelect(sale)}
      className="flex w-full items-center justify-between gap-4 rounded-lg border p-4 text-left transition-colors hover:bg-muted/50"
    >
      <div className="min-w-0">
        <p className="font-medium">
          {formatMoney(sale.totalCents, sale.currency)}
        </p>
        <p className="text-sm text-muted-foreground">
          {format(new Date(sale.createdAt), 'd MMM yyyy')} · {itemCount}{' '}
          {itemCount === 1 ? 'item' : 'items'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={saleStatusVariant(sale.status)} className="text-xs">
          {saleStatusLabels[sale.status]}
        </Badge>
        <ChevronRight className="size-4 text-muted-foreground" />
      </div>
    </button>
  );
}

export function ClientSalesTab({ leadId }: { leadId: string }) {
  const { sales, isLoading, isError } = useClientSales(leadId);
  const [selectedSale, setSelectedSale] = useState<SaleWithRelations | null>(
    null
  );

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((n) => (
          <Skeleton key={n} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Failed to load sales.
      </p>
    );
  }

  if (sales.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Receipt />
          </EmptyMedia>
          <EmptyTitle>No sales yet</EmptyTitle>
          <EmptyDescription>
            Payments and invoices for this client will appear here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const completed = sales.filter((s) => s.status === 'completed');
  const currency = sales[0]?.currency ?? 'eur';
  const totalSpent = completed.reduce((sum, s) => sum + s.totalCents, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div>
            <p className="text-sm text-muted-foreground">Total spent</p>
            <p className="text-2xl font-semibold">
              {formatMoney(totalSpent, currency)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Sales</p>
            <p className="text-2xl font-semibold">{sales.length}</p>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {sales.map((sale) => (
          <SaleRow key={sale.id} sale={sale} onSelect={setSelectedSale} />
        ))}
      </div>

      <SaleDetailSheet
        sale={selectedSale}
        open={!!selectedSale}
        onOpenChange={(open) => !open && setSelectedSale(null)}
      />
    </div>
  );
}
