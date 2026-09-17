import { createFileRoute } from '@tanstack/react-router';
import { addDays, format } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

import { PageShell } from '@/components/app/page-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  formatMoney,
  useCheckoutStore,
  useGetDailySummary,
} from '@/features/sales';
import {
  ExportMenu,
  SalesPageHeader,
  downloadCsv,
} from '@/features/sales/components/pages/sales-page-ui';
import { useIsMobile } from '@/hooks/use-mobile';
import type { SaleDailySummary } from '@borradh-workspace/api-client/types';

import { DailySummaryMobile } from './-components/daily-summary-mobile';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/sales/daily-summary'
)({
  component: DailySummaryRoute,
});

function DailySummaryRoute() {
  const isMobile = useIsMobile();
  if (isMobile) return <DailySummaryMobile />;
  return <DailySummaryPage />;
}

/** Transaction-summary rows (fixed order, mapped from item-type totals). */
const ITEM_ROWS: { label: string; keys: string[] }[] = [
  { label: 'Services', keys: ['service', 'appointment'] },
  { label: 'Service add-ons', keys: [] },
  { label: 'Products', keys: ['product'] },
  { label: 'Shipping', keys: [] },
  { label: 'Gift cards', keys: ['gift_card'] },
  { label: 'Memberships', keys: ['membership'] },
  { label: 'Late cancellation fees', keys: [] },
  { label: 'No-show fees', keys: [] },
  { label: 'Refund amount', keys: [] },
];

/** Cash-movement rows (fixed order, mapped from payment-method totals). */
const METHOD_ROWS: { label: string; keys: string[] }[] = [
  { label: 'Cash', keys: ['cash'] },
  {
    label: 'Other',
    keys: ['card_terminal', 'qr_self_checkout', 'manual_card'],
  },
  { label: 'Gift card redemptions', keys: ['gift_card'] },
];

function TransactionSummary({ summary }: { summary: SaleDailySummary }) {
  const rows = ITEM_ROWS.map((row) => {
    let salesQty = 0;
    let refundQty = 0;
    let grossCents = 0;
    for (const key of row.keys) {
      const r = summary.itemRows[key];
      if (r) {
        salesQty += r.salesQty;
        refundQty += r.refundQty;
        grossCents += r.grossCents;
      }
    }
    return { ...row, salesQty, refundQty, grossCents };
  });
  const totalSalesQty = rows.reduce((s, r) => s + r.salesQty, 0);
  const totalRefundQty = rows.reduce((s, r) => s + r.refundQty, 0);

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Transaction summary</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item type</TableHead>
            <TableHead className="text-right">Sales qty</TableHead>
            <TableHead className="text-right">Refund qty</TableHead>
            <TableHead className="text-right">Gross total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.label}>
              <TableCell>{row.label}</TableCell>
              <TableCell className="text-right">{row.salesQty}</TableCell>
              <TableCell className="text-right">{row.refundQty}</TableCell>
              <TableCell className="text-right">
                {formatMoney(row.grossCents, summary.currency)}
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="font-semibold">
            <TableCell>Total Sales</TableCell>
            <TableCell className="text-right">{totalSalesQty}</TableCell>
            <TableCell className="text-right">{totalRefundQty}</TableCell>
            <TableCell className="text-right">
              {formatMoney(summary.totalCents, summary.currency)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
  );
}

function CashMovementSummary({ summary }: { summary: SaleDailySummary }) {
  const rows = METHOD_ROWS.map((row) => {
    let collectedCents = 0;
    let refundsCents = 0;
    for (const key of row.keys) {
      const r = summary.methodRows[key];
      if (r) {
        collectedCents += r.collectedCents;
        refundsCents += r.refundsCents;
      }
    }
    return { ...row, collectedCents, refundsCents };
  });
  const totalCollected = Object.values(summary.methodRows).reduce(
    (s, r) => s + r.collectedCents,
    0
  );
  const totalRefunds = Object.values(summary.methodRows).reduce(
    (s, r) => s + r.refundsCents,
    0
  );

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">Cash movement summary</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Payment type</TableHead>
            <TableHead className="text-right">Payments collected</TableHead>
            <TableHead className="text-right">Refunds paid</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.label}>
              <TableCell>{row.label}</TableCell>
              <TableCell className="text-right">
                {formatMoney(row.collectedCents, summary.currency)}
              </TableCell>
              <TableCell className="text-right">
                {formatMoney(row.refundsCents, summary.currency)}
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="font-semibold">
            <TableCell>Payments collected</TableCell>
            <TableCell className="text-right">
              {formatMoney(totalCollected, summary.currency)}
            </TableCell>
            <TableCell className="text-right">
              {formatMoney(totalRefunds, summary.currency)}
            </TableCell>
          </TableRow>
          <TableRow className="font-semibold">
            <TableCell>Of which tips</TableCell>
            <TableCell className="text-right">
              {formatMoney(summary.tipCents, summary.currency)}
            </TableCell>
            <TableCell className="text-right">
              {formatMoney(0, summary.currency)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
  );
}

function DailySummaryPage() {
  const openCheckout = useCheckoutStore((s) => s.openCheckout);
  const [date, setDate] = useState(() => new Date());
  const dateStr = format(date, 'yyyy-MM-dd');
  const { summary, isLoading } = useGetDailySummary({ date: dateStr });
  const isToday = dateStr === format(new Date(), 'yyyy-MM-dd');

  const handleExport = () => {
    if (!summary) return;
    downloadCsv(
      `daily-sales-${dateStr}.csv`,
      ['Item type', 'Sales qty', 'Refund qty', 'Gross total'],
      ITEM_ROWS.map((row) => {
        let qty = 0;
        let gross = 0;
        for (const key of row.keys) {
          const r = summary.itemRows[key];
          if (r) {
            qty += r.salesQty;
            gross += r.grossCents;
          }
        }
        return [row.label, qty, 0, formatMoney(gross, summary.currency)];
      })
    );
  };

  const nav = useMemo(
    () => ({
      prev: () => setDate((d) => addDays(d, -1)),
      next: () => setDate((d) => addDays(d, 1)),
      today: () => setDate(new Date()),
    }),
    []
  );

  return (
    <>
      <title>Daily Sales | Borradh</title>
      <PageShell>
        <SalesPageHeader
          title="Daily sales"
          description="View, filter and export the transactions and cash movement for the day."
          actions={
            <>
              <ExportMenu onExportCsv={handleExport} disabled={!summary} />
              <Button className="rounded-full" onClick={() => openCheckout()}>
                <Plus className="size-4" />
                Add new
              </Button>
            </>
          }
        />

        <div className="flex items-center gap-2 rounded-2xl bg-muted/50 p-3">
          <Button
            variant="outline"
            size="icon"
            className="size-9 rounded-full bg-background"
            onClick={nav.prev}
            aria-label="Previous day"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            className="rounded-full bg-background"
            onClick={nav.today}
            disabled={isToday}
          >
            Today
          </Button>
          <div className="rounded-full border bg-background px-4 py-2 text-sm font-medium">
            {format(date, 'EEEE d MMM, yyyy')}
          </div>
          <Button
            variant="outline"
            size="icon"
            className="size-9 rounded-full bg-background"
            onClick={nav.next}
            aria-label="Next day"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        {isLoading || !summary ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-96" />
            <Skeleton className="h-96" />
          </div>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <TransactionSummary summary={summary} />
            <CashMovementSummary summary={summary} />
          </div>
        )}
      </PageShell>
    </>
  );
}
