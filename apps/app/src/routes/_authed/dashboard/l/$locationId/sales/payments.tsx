import { useResolvedRoutes } from '@/lib/use-routes';
import { Link, createFileRoute } from '@tanstack/react-router';
import { format } from 'date-fns';
import { CreditCard } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ListPage } from '@/components/app/list-page';
import type { ListColumn } from '@/components/app/list-page';
import { formatMoney, useListSales } from '@/features/sales';
import { SaleDetailSheet } from '@/features/sales/components/pages/sale-detail-sheet';
import {
  type DatePreset,
  DatePresetMenu,
  ExportMenu,
  FiltersButton,
  datePresetRange,
  downloadCsv,
  shortRef,
} from '@/features/sales/components/pages/sales-page-ui';
import { salePaymentMethodLabels } from '@borradh-workspace/api-client/types';
import type { SaleWithRelations } from '@borradh-workspace/api-client/types';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/sales/payments'
)({
  component: PaymentsPage,
});

/** One succeeded payment, carrying the sale it settled. */
type PaymentRow = {
  payment: SaleWithRelations['payments'][number];
  sale: SaleWithRelations;
};

function clientName(sale: SaleWithRelations): string {
  if (!sale.lead) return 'Walk-in';
  return `${sale.lead.firstName} ${sale.lead.lastName ?? ''}`.trim();
}

/**
 * Payment transactions, on the shared `ListPage`. The date range, the search
 * and the filter chips stay HERE — the shell renders what `rows` contains and
 * never filters on its own.
 */
function PaymentsPage() {
  const routes = useResolvedRoutes();
  const [preset, setPreset] = useState<DatePreset>('month');
  const [search, setSearch] = useState('');
  const [selectedSale, setSelectedSale] = useState<SaleWithRelations | null>(
    null
  );
  const range = useMemo(() => datePresetRange(preset), [preset]);

  const { sales, isLoading, isError, error } = useListSales({
    from: range.from,
    to: range.to,
    limit: 200,
  });

  const rows = useMemo<PaymentRow[]>(() => {
    const q = search.trim().toLowerCase();
    return sales
      .flatMap((sale) =>
        sale.payments
          .filter((payment) => payment.status === 'succeeded')
          .map((payment) => ({ payment, sale }))
      )
      .filter(({ sale }) => {
        if (!q) return true;
        return (
          clientName(sale).toLowerCase().includes(q) ||
          shortRef(sale.id).toLowerCase().includes(q)
        );
      });
  }, [sales, search]);

  const totalCents = useMemo(
    () => rows.reduce((sum, { payment }) => sum + payment.amountCents, 0),
    [rows]
  );

  const handleExport = () => {
    downloadCsv(
      'payments.csv',
      [
        'Payment date',
        'Location',
        'Ref',
        'Client',
        'Team member',
        'Type',
        'Method',
        'Amount',
      ],
      rows.map(({ payment, sale }) => [
        format(new Date(payment.createdAt), 'd MMM yyyy'),
        sale.location?.name ?? '—',
        `#${shortRef(sale.id)}`,
        clientName(sale),
        sale.createdBy?.name ?? '—',
        payment.status === 'refunded' ? 'Refund' : 'Sale',
        salePaymentMethodLabels[payment.method],
        formatMoney(payment.amountCents, sale.currency),
      ])
    );
  };

  const columns: ListColumn<PaymentRow>[] = [
    {
      id: 'date',
      header: 'Payment date',
      cell: ({ payment }) => format(new Date(payment.createdAt), 'd MMM yyyy'),
    },
    {
      id: 'location',
      header: 'Location',
      cell: ({ sale }) => sale.location?.name ?? '—',
    },
    {
      id: 'ref',
      header: 'Ref #',
      cell: ({ sale }) => (
        <span className="font-medium text-primary">#{shortRef(sale.id)}</span>
      ),
    },
    {
      id: 'client',
      header: 'Client',
      mobile: 'primary',
      cell: ({ sale }) =>
        sale.lead ? (
          // The row itself opens the sale sheet; this link goes somewhere else,
          // so it must not also trigger the row.
          <Link
            className="font-medium text-primary hover:underline"
            onClick={(event) => event.stopPropagation()}
            to={routes.customerDetail(sale.lead.id)}
          >
            {clientName(sale)}
          </Link>
        ) : (
          <span className="text-muted-foreground">Walk-in</span>
        ),
    },
    {
      id: 'teamMember',
      header: 'Team member',
      cell: ({ sale }) => (
        <span className="text-primary">{sale.createdBy?.name ?? '—'}</span>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      cell: ({ payment }) =>
        payment.status === 'refunded' ? 'Refund' : 'Sale',
    },
    {
      id: 'method',
      header: 'Method',
      // Under the client name on a phone: how they paid, and when.
      mobile: 'secondary',
      cell: ({ payment }) =>
        `${salePaymentMethodLabels[payment.method]} · ${format(
          new Date(payment.createdAt),
          'd MMM yyyy'
        )}`,
    },
    {
      id: 'amount',
      header: 'Amount',
      align: 'right',
      mobile: 'trailing',
      cell: ({ payment, sale }) => (
        <span className="font-medium">
          {formatMoney(payment.amountCents, sale.currency)}
        </span>
      ),
    },
  ];

  return (
    <>
      <title>Payments | Borradh</title>

      <ListPage<PaymentRow>
        config={{
          title: 'Payment transactions',
          columns,
          rows,
          rowKey: ({ payment }) => payment.id,
          // E2E fixtures address rows by this id on BOTH viewports; the
          // deleted mobile list emitted it and the shared list must too.
          // Keyed on the SALE, not the payment — `saleRow()` looks up a sale.
          rowTestId: ({ sale }) => `sale-row-${sale.id}`,
          onRowClick: ({ sale }) => setSelectedSale(sale),
          searchPlaceholder: 'Search by Sale or Client',
          search,
          onSearchChange: setSearch,
          toolbar: (
            <div className="flex flex-wrap items-center gap-2">
              <DatePresetMenu onChange={setPreset} value={preset} />
              <FiltersButton />
              <ExportMenu
                disabled={!rows.length}
                label="Options"
                onExportCsv={handleExport}
              />
              {/*
                The old table carried a "Total" row inside its body. The list
                shell has no footer row, and a total belongs beside the filters
                that produced it anyway.
              */}
              {rows.length > 0 && (
                <span className="text-muted-foreground text-sm">
                  Total{' '}
                  <span className="font-semibold text-foreground">
                    {formatMoney(totalCents, sales[0]?.currency)}
                  </span>
                </span>
              )}
            </div>
          ),
          isLoading,
          isError,
          errorMessage: error?.message ?? "Couldn't load payments",
          empty: {
            icon: CreditCard,
            title: search ? 'No matching payments' : 'No payments yet',
            description: search
              ? 'No payment matches that search.'
              : 'Payments recorded against sales will appear here.',
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
