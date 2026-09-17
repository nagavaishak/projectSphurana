import { addDays, format } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';

import { MobilePageShell } from '@/components/app/mobile-page-shell';
import { Button } from '@/components/ui/button';
import {
  MobileRecordList,
  MobileRecordListLabel,
  MobileRecordListSkeleton,
  MobileRecordRow,
} from '@/features/mobile-ui';
import {
  formatMoney,
  useCheckoutStore,
  useGetDailySummary,
} from '@/features/sales';
import { downloadCsv } from '@/features/sales/components/pages/sales-page-ui';
import type { SaleDailySummary } from '@borradh-workspace/api-client/types';

import {
  SalesMobileControls,
  SalesMobileOptionsMenu,
  joinMeta,
} from './sales-mobile-shared';

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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#ECECEC] bg-white px-4 py-3">
      <p className="text-[12px] font-medium uppercase tracking-wide text-[#8E8E93]">
        {label}
      </p>
      <p className="mt-1 text-[18px] font-semibold text-[#0A0A0A]">{value}</p>
    </div>
  );
}

function DailySummaryContent({ summary }: { summary: SaleDailySummary }) {
  const itemRows = ITEM_ROWS.map((row) => {
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
  const totalSalesQty = itemRows.reduce((s, r) => s + r.salesQty, 0);
  const totalRefundQty = itemRows.reduce((s, r) => s + r.refundQty, 0);

  const methodRows = METHOD_ROWS.map((row) => {
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
    <>
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          label="Total sales"
          value={formatMoney(summary.totalCents, summary.currency)}
        />
        <StatCard
          label="Payments collected"
          value={formatMoney(totalCollected, summary.currency)}
        />
        <StatCard
          label="Refunds paid"
          value={formatMoney(totalRefunds, summary.currency)}
        />
        <StatCard
          label="Of which tips"
          value={formatMoney(summary.tipCents, summary.currency)}
        />
      </div>

      <MobileRecordListLabel>Transaction summary</MobileRecordListLabel>
      <MobileRecordList>
        {itemRows.map((row) => (
          <MobileRecordRow
            key={row.label}
            title={row.label}
            subtitle={joinMeta(
              `Sales qty ${row.salesQty}`,
              `Refund qty ${row.refundQty}`
            )}
            trailing={formatMoney(row.grossCents, summary.currency)}
          />
        ))}
        <MobileRecordRow
          title="Total sales"
          subtitle={joinMeta(
            `Sales qty ${totalSalesQty}`,
            `Refund qty ${totalRefundQty}`
          )}
          trailing={formatMoney(summary.totalCents, summary.currency)}
          className="bg-[#FAFAFA] font-semibold"
        />
      </MobileRecordList>

      <MobileRecordListLabel>Cash movement summary</MobileRecordListLabel>
      <MobileRecordList>
        {methodRows.map((row) => (
          <MobileRecordRow
            key={row.label}
            title={row.label}
            subtitle={`Refunds paid ${formatMoney(row.refundsCents, summary.currency)}`}
            trailing={formatMoney(row.collectedCents, summary.currency)}
          />
        ))}
        <MobileRecordRow
          title="Payments collected"
          subtitle={`Refunds paid ${formatMoney(totalRefunds, summary.currency)}`}
          trailing={formatMoney(totalCollected, summary.currency)}
          className="bg-[#FAFAFA] font-semibold"
        />
        <MobileRecordRow
          title="Of which tips"
          subtitle={`Refunds paid ${formatMoney(0, summary.currency)}`}
          trailing={formatMoney(summary.tipCents, summary.currency)}
          className="bg-[#FAFAFA] font-semibold"
        />
      </MobileRecordList>
    </>
  );
}

export function DailySummaryMobile() {
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

  return (
    <MobilePageShell contentClassName="px-4 pb-4" title="Daily sales">
      <title>Daily Sales | Borradh</title>

      <SalesMobileControls>
        <div className="flex flex-1 items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="size-9 shrink-0 rounded-full bg-background"
            onClick={() => setDate((d) => addDays(d, -1))}
            aria-label="Previous day"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <button
            type="button"
            onClick={() => setDate(new Date())}
            disabled={isToday}
            className="min-w-0 flex-1 truncate rounded-full border bg-background px-3 py-2 text-center text-[13px] font-medium"
          >
            {format(date, 'EEE d MMM, yyyy')}
          </button>
          <Button
            variant="outline"
            size="icon"
            className="size-9 shrink-0 rounded-full bg-background"
            onClick={() => setDate((d) => addDays(d, 1))}
            aria-label="Next day"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <SalesMobileOptionsMenu
          onExportCsv={handleExport}
          disabled={!summary}
        />
        <Button
          size="sm"
          className="ml-auto rounded-full"
          onClick={() => openCheckout()}
        >
          <Plus className="size-4" />
          Add new
        </Button>
      </SalesMobileControls>

      {isLoading || !summary ? (
        <MobileRecordListSkeleton rows={6} />
      ) : (
        <DailySummaryContent summary={summary} />
      )}
    </MobilePageShell>
  );
}
