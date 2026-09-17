import { createFileRoute } from '@tanstack/react-router';
import { format } from 'date-fns';
import { ArrowDownUp, Receipt } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ListPage } from '@/components/app/list-page';
import type { ListColumn } from '@/components/app/list-page';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatMoney, useCheckoutStore, useListSales } from '@/features/sales';
import { SaleDetailSheet } from '@/features/sales/components/pages/sale-detail-sheet';
import {
  type DatePreset,
  DatePresetMenu,
  ExportMenu,
  FiltersButton,
  StatusBadge,
  ToolbarButton,
  datePresetRange,
  downloadCsv,
  saleStatusTone,
  shortRef,
} from '@/features/sales/components/pages/sales-page-ui';
import { useIsMobile } from '@/hooks/use-mobile';
import { saleStatusLabels } from '@borradh-workspace/api-client/types';
import type { SaleWithRelations } from '@borradh-workspace/api-client/types';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/sales/list'
)({
  component: SalesListPage,
});

type SortKey = 'newest' | 'oldest' | 'total';
const sortLabels: Record<SortKey, string> = {
  newest: 'Date (newest first)',
  oldest: 'Date (oldest first)',
  total: 'Total (high to low)',
};

function clientName(sale: SaleWithRelations): string {
  if (!sale.lead) return 'Walk-in';
  return `${sale.lead.firstName} ${sale.lead.lastName ?? ''}`.trim();
}

/**
 * The sales list, on the shared `ListPage`. Tabs, date range, search and sort
 * all stay HERE and act on `rows` — the shell renders what it is given and
 * never filters or sorts on its own.
 */
function SalesListPage() {
  const openCheckout = useCheckoutStore((s) => s.openCheckout);
  const [tab, setTab] = useState<'sales' | 'drafts'>('sales');
  const [preset, setPreset] = useState<DatePreset>('today');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [selectedSale, setSelectedSale] = useState<SaleWithRelations | null>(
    null
  );
  const range = useMemo(() => datePresetRange(preset), [preset]);
  const { sales, isLoading, isError, error } = useListSales({
    from: range.from,
    to: range.to,
    limit: 200,
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = sales
      .filter((sale) =>
        tab === 'drafts' ? sale.status === 'open' : sale.status !== 'open'
      )
      .filter((sale) => {
        if (!q) return true;
        return (
          clientName(sale).toLowerCase().includes(q) ||
          shortRef(sale.id).toLowerCase().includes(q)
        );
      });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sort === 'total') return b.totalCents - a.totalCents;
      const diff =
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return sort === 'oldest' ? diff : -diff;
    });
    return sorted;
  }, [sales, search, sort, tab]);

  const handleExport = () => {
    downloadCsv(
      'sales.csv',
      ['Ref', 'Client', 'Date', 'Items', 'Status', 'Total'],
      rows.map((sale) => [
        `#${shortRef(sale.id)}`,
        clientName(sale),
        format(new Date(sale.createdAt), 'd MMM yyyy, HH:mm'),
        sale.items.length,
        saleStatusLabels[sale.status],
        formatMoney(sale.totalCents, sale.currency),
      ])
    );
  };

  const isMobile = useIsMobile();

  const columns: ListColumn<SaleWithRelations>[] = [
    {
      id: 'ref',
      header: 'Ref #',
      cell: (sale) => (
        <span className="font-medium text-primary">#{shortRef(sale.id)}</span>
      ),
    },
    {
      id: 'client',
      header: 'Client',
      mobile: 'primary',
      cell: (sale) => clientName(sale),
    },
    {
      id: 'created',
      header: 'Created',
      // Under the client name on a phone: the reference and when it was taken.
      mobile: 'secondary',
      cell: (sale) => (
        <span className="text-muted-foreground">
          {format(new Date(sale.createdAt), 'd MMM yyyy, HH:mm')}
          {/*
            The phone drops every column without a mobile role, and the four
            roles are already spoken for (client / date / total). That left a
            VOIDED sale looking identical to a live one on a phone — the single
            most important thing about the row, invisible. Desktop has its own
            Status column, so this rides along with the date on mobile only
            rather than duplicating it in the table.
          */}
          {isMobile && (
            <>
              {' · '}
              <span className="font-medium">
                {saleStatusLabels[sale.status]}
              </span>
            </>
          )}
        </span>
      ),
    },
    {
      id: 'items',
      header: 'Items',
      cell: (sale) => sale.items.length,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (sale) => (
        <StatusBadge tone={saleStatusTone[sale.status]}>
          {saleStatusLabels[sale.status]}
        </StatusBadge>
      ),
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
  ];

  return (
    <>
      <title>Sales | Borradh</title>

      <ListPage<SaleWithRelations>
        config={{
          title: 'Sales',
          columns,
          rows,
          rowKey: (sale) => sale.id,
          // E2E fixtures address rows by this id on BOTH viewports; the deleted
          // hand-written mobile list emitted it and the shared list must too.
          rowTestId: (sale) => `sale-row-${sale.id}`,
          onRowClick: (sale) => setSelectedSale(sale),
          searchPlaceholder: 'Search by Sale or Client',
          search,
          onSearchChange: setSearch,
          toolbar: (
            <div className="flex flex-wrap items-center gap-2">
              <Tabs
                onValueChange={(v) => setTab(v as 'sales' | 'drafts')}
                value={tab}
              >
                <TabsList>
                  <TabsTrigger value="sales">Sales</TabsTrigger>
                  <TabsTrigger value="drafts">Drafts</TabsTrigger>
                </TabsList>
              </Tabs>
              <DatePresetMenu onChange={setPreset} value={preset} />
              <FiltersButton />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <ToolbarButton>
                    <ArrowDownUp className="size-4" />
                    Sort by
                  </ToolbarButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuRadioGroup
                    onValueChange={(v) => setSort(v as SortKey)}
                    value={sort}
                  >
                    {(Object.keys(sortLabels) as SortKey[]).map((key) => (
                      <DropdownMenuRadioItem key={key} value={key}>
                        {sortLabels[key]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <ExportMenu
                disabled={!rows.length}
                label="Options"
                onExportCsv={handleExport}
              />
            </div>
          ),
          primaryAction: {
            label: 'Add new',
            mobileLabel: 'Add',
            onClick: () => openCheckout(),
          },
          isLoading,
          isError,
          errorMessage: error?.message ?? "Couldn't load sales",
          empty: {
            icon: Receipt,
            title: tab === 'drafts' ? 'No drafts yet' : 'No sales yet',
            description: 'Sales you take will show up here.',
            action: (
              <Button
                className="rounded-full"
                onClick={() => openCheckout()}
                variant="outline"
              >
                Create new sale
              </Button>
            ),
          },
        }}
      />

      <SaleDetailSheet
        onOpenChange={(open) => !open && setSelectedSale(null)}
        open={!!selectedSale}
        sale={selectedSale}
      />
    </>
  );
}
