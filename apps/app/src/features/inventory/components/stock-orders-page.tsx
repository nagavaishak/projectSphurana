import type { StockOrder } from '@borradh-workspace/api-client/types';
import { useNavigate } from '@tanstack/react-router';
import { Truck } from 'lucide-react';
import { useState } from 'react';

import { ListPage } from '@/components/app/list-page';
import type { ListColumn } from '@/components/app/list-page';
import { useListLocations } from '@/features/organization-locations';

import { useListStockOrders, useListSuppliers } from '../api';
import { StockOrderStatusBadge } from './status-badges';
import { StockOrderDetailDialog } from './stock-order-detail-dialog';

/**
 * Stock orders, on the shared `ListPage`.
 *
 * `StockOrdersMobileList` is gone — the phone list is the same column config the
 * table renders.
 *
 * A row opens the DETAIL SHEET, not `/edit/stock-order/:id`: the stock-order
 * entity editor is deliberately create-only (see `entity-editors/definitions`) —
 * an existing order is receipted or cancelled from that sheet, not re-edited
 * field by field.
 */
export function StockOrdersPage() {
  const { stockOrders, isLoading, isError, error } = useListStockOrders();
  const { suppliers } = useListSuppliers();
  const { locations } = useListLocations();

  const navigate = useNavigate();
  const openCreate = () =>
    void navigate({ params: { entity: 'stock-order' }, to: '/create/$entity' });
  const [detailId, setDetailId] = useState<string | null>(null);

  const supplierName = (id: string | null) =>
    id ? (suppliers.find((s) => s.id === id)?.name ?? '—') : '—';
  const locationName = (id: string | null) =>
    id ? (locations.find((l) => l.id === id)?.name ?? '—') : '—';

  const columns: ListColumn<StockOrder>[] = [
    {
      cell: (order) => (
        <span className="font-medium">{supplierName(order.supplierId)}</span>
      ),
      header: 'Supplier',
      id: 'supplier',
      mobile: 'primary',
    },
    {
      cell: (order) => locationName(order.locationId),
      header: 'Deliver to',
      id: 'location',
      mobile: 'secondary',
    },
    {
      cell: (order) =>
        order.expectedByDate
          ? new Date(order.expectedByDate).toLocaleDateString()
          : '—',
      header: 'Expected',
      id: 'expected',
    },
    {
      cell: (order) => new Date(order.createdAt).toLocaleDateString(),
      header: 'Created',
      id: 'created',
    },
    {
      cell: (order) => <StockOrderStatusBadge status={order.status} />,
      header: 'Status',
      id: 'status',
      mobile: 'trailing',
    },
  ];

  return (
    <>
      <title>Stock orders | Borradh</title>

      <ListPage<StockOrder>
        config={{
          columns,
          empty: {
            description: 'Create an order to restock products from a supplier.',
            icon: Truck,
            title: 'No stock orders yet',
          },
          errorMessage: error?.message ?? 'Failed to load stock orders',
          isError,
          isLoading,
          primaryAction: {
            label: 'New order',
            mobileLabel: 'New',
            onClick: openCreate,
          },
          rowKey: (order) => order.id,
          onRowClick: (order) => setDetailId(order.id),
          rows: stockOrders,
          title: 'Stock orders',
        }}
      />

      <StockOrderDetailDialog
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
        stockOrderId={detailId}
      />
    </>
  );
}
