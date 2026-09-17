import { useBranchRoutes } from '@/lib/use-routes';
import { Link, createFileRoute } from '@tanstack/react-router';
import { format } from 'date-fns';
import { Check, PackageCheck, Store } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ListPage } from '@/components/app/list-page';
import type { ListColumn } from '@/components/app/list-page';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  formatMoney,
  useListSales,
  useUpdateShopFulfilment,
} from '@/features/sales';
import {
  ExportMenu,
  downloadCsv,
} from '@/features/sales/components/pages/sales-page-ui';
import type { SaleWithRelations } from '@borradh-workspace/api-client/types';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/sales/product-orders'
)({
  component: ProductOrdersPage,
});

/** One paid online collection order — deliberately not one row per product. */
type ProductOrderRow = SaleWithRelations;
type QueueTab = 'awaiting_collection' | 'ready' | 'collected';

const queueTabs: Array<{ value: QueueTab; label: string }> = [
  { value: 'awaiting_collection', label: 'To pick' },
  { value: 'ready', label: 'Ready to collect' },
  { value: 'collected', label: 'Collected' },
];

function FulfilmentAction({ sale }: { sale: SaleWithRelations }) {
  const { updateFulfilment, isUpdating } = useUpdateShopFulfilment(sale.id);
  if (sale.fulfilmentStatus === 'awaiting_collection') {
    return (
      <Button
        size="sm"
        disabled={isUpdating}
        onClick={() => updateFulfilment('ready')}
      >
        <PackageCheck className="mr-1 size-4" /> Mark ready
      </Button>
    );
  }
  if (sale.fulfilmentStatus === 'ready') {
    return (
      <Button
        size="sm"
        disabled={isUpdating}
        onClick={() => updateFulfilment('collected')}
      >
        <Check className="mr-1 size-4" /> Collected
      </Button>
    );
  }
  return <span className="text-muted-foreground text-sm">Collected</span>;
}

/**
 * Product orders, on the shared `ListPage`. The `ProductOrdersMobile` component
 * that restated these columns by hand is gone — both layouts render from the
 * same config.
 */
function ProductOrdersPage() {
  const routes = useBranchRoutes();
  const { sales, isLoading, isError, error } = useListSales({ limit: 200 });
  const [queueTab, setQueueTab] = useState<QueueTab>('awaiting_collection');

  const rows = useMemo<ProductOrderRow[]>(
    () =>
      sales
        .filter(
          (sale) =>
            sale.fulfilmentMethod === 'collect' &&
            sale.fulfilmentStatus === queueTab
        )
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        ),
    [queueTab, sales]
  );

  const handleExport = () => {
    downloadCsv(
      'product-orders.csv',
      ['Created', 'Items', 'Qty', 'Unit price', 'Total'],
      rows.map((sale) => [
        format(new Date(sale.createdAt), 'd MMM yyyy, HH:mm'),
        sale.items.map((item) => `${item.name} ×${item.quantity}`).join(', '),
        sale.items.reduce((total, item) => total + item.quantity, 0),
        '',
        formatMoney(sale.totalCents, sale.currency),
      ])
    );
  };

  const columns: ListColumn<ProductOrderRow>[] = [
    {
      id: 'created',
      header: 'Created',
      // Under the product name on a phone — the money columns are the two the
      // phone must not stack, so the date is what fits beneath the title.
      mobile: 'secondary',
      cell: (sale) => (
        <span className="text-muted-foreground">
          {format(new Date(sale.createdAt), 'd MMM yyyy, HH:mm')}
        </span>
      ),
    },
    {
      id: 'name',
      header: 'Items',
      mobile: 'primary',
      cell: (sale) =>
        sale.items.map((item) => `${item.name} ×${item.quantity}`).join(', '),
    },
    {
      id: 'quantity',
      header: 'Qty',
      cell: (sale) =>
        sale.items.reduce((total, item) => total + item.quantity, 0),
    },
    {
      id: 'unitPrice',
      header: 'Unit price',
      align: 'right',
      cell: () => '—',
    },
    {
      id: 'total',
      header: 'Total',
      align: 'right',
      mobile: 'trailing',
      cell: (sale) => (
        <span className="font-medium">
          {formatMoney(sale.totalCents, sale.currency)}
        </span>
      ),
    },
    {
      id: 'fulfilment',
      header: 'Collection',
      cell: (sale) => <FulfilmentAction sale={sale} />,
    },
  ];

  // Two different "no rows" situations: an org that has taken sales but sold no
  // products, and an org whose store is not set up at all. Only the second one
  // gets a call to action.
  const hasSoldSomething = sales.length > 0;

  return (
    <>
      <title>Product Orders | Borradh</title>

      <ListPage<ProductOrderRow>
        config={{
          title: 'Product orders',
          description: 'Paid online orders waiting to be handed over.',
          columns,
          rows,
          rowKey: (sale) => sale.id,
          filters: (
            <Tabs
              onValueChange={(value) => setQueueTab(value as QueueTab)}
              value={queueTab}
            >
              <TabsList>
                {queueTabs.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value}>
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ),
          toolbar: (
            <ExportMenu
              disabled={!rows.length}
              label="Options"
              onExportCsv={handleExport}
            />
          ),
          isLoading,
          isError,
          errorMessage: error?.message ?? "Couldn't load product orders",
          empty: hasSoldSomething
            ? {
                icon: Store,
                title:
                  queueTab === 'awaiting_collection'
                    ? 'Nothing to pick'
                    : queueTab === 'ready'
                      ? 'Nothing ready to collect'
                      : 'No collected orders yet',
                description:
                  'Online orders appear here as soon as they are paid.',
              }
            : {
                icon: Store,
                title: 'Online store is not yet set up',
                description:
                  'Set up your store in minutes and get clients buying your products online.',
                action: (
                  <Button asChild className="rounded-full" variant="outline">
                    <Link to={routes.catalogProducts}>Set up now</Link>
                  </Button>
                ),
              },
        }}
      />
    </>
  );
}
