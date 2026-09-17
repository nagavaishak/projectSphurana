import { createFileRoute } from '@tanstack/react-router';
import { format } from 'date-fns';
import { Gift } from 'lucide-react';

import { ListPage } from '@/components/app/list-page';
import type { ListColumn } from '@/components/app/list-page';
import { useListGiftCards } from '@/features/gift-cards/api';
import { formatMoney, useCheckoutStore } from '@/features/sales';
import {
  ExportMenu,
  downloadCsv,
} from '@/features/sales/components/pages/sales-page-ui';
import { cn } from '@/lib/utils';
import type { GiftCard } from '@borradh-workspace/api-client/types';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/sales/gift-cards'
)({
  component: GiftCardSalesPage,
});

/**
 * Gift card sales, on the shared `ListPage`.
 *
 * There is no `useIsMobile` branch and no `GiftCardsMobile` any more: the
 * desktop table and the phone list render from the SAME column config.
 */
function GiftCardSalesPage() {
  const openCheckout = useCheckoutStore((s) => s.openCheckout);
  const { giftCards, isLoading, isError, error } = useListGiftCards({
    limit: 100,
  });

  const handleExport = () => {
    downloadCsv(
      'gift-cards-sold.csv',
      ['Code', 'Initial amount', 'Balance', 'Expiry', 'Created'],
      giftCards.map((gc) => [
        gc.code,
        formatMoney(gc.initialAmountCents, gc.currency),
        formatMoney(gc.balanceCents, gc.currency),
        gc.expiresAt ? format(new Date(gc.expiresAt), 'd MMM yyyy') : 'Never',
        format(new Date(gc.createdAt), 'd MMM yyyy'),
      ])
    );
  };

  const columns: ListColumn<GiftCard>[] = [
    {
      id: 'code',
      header: 'Code',
      mobile: 'primary',
      cell: (giftCard) => (
        <span className="font-mono tracking-tight">{giftCard.code}</span>
      ),
    },
    {
      id: 'initialAmount',
      header: 'Initial amount',
      align: 'right',
      cell: (giftCard) =>
        formatMoney(giftCard.initialAmountCents, giftCard.currency),
    },
    {
      id: 'balance',
      header: 'Balance',
      align: 'right',
      // The one number that matters on a phone: what is left on the card.
      mobile: 'trailing',
      cell: (giftCard) => (
        <span
          className={cn(
            'font-medium',
            // A spent card reads as spent without needing a second column.
            giftCard.balanceCents === 0 && 'text-muted-foreground'
          )}
        >
          {formatMoney(giftCard.balanceCents, giftCard.currency)}
        </span>
      ),
    },
    {
      id: 'expiry',
      header: 'Expiry',
      cell: (giftCard) =>
        giftCard.expiresAt
          ? format(new Date(giftCard.expiresAt), 'd MMM yyyy')
          : 'Never',
    },
    {
      id: 'created',
      header: 'Created',
      // A date, not a third competing money value, under the code.
      mobile: 'secondary',
      cell: (giftCard) => format(new Date(giftCard.createdAt), 'd MMM yyyy'),
    },
  ];

  return (
    <>
      <title>Gift card sales | Borradh</title>

      <ListPage<GiftCard>
        config={{
          title: 'Gift card sales',
          columns,
          rows: giftCards,
          rowKey: (giftCard) => giftCard.id,
          toolbar: (
            <ExportMenu
              disabled={!giftCards.length}
              label="Options"
              onExportCsv={handleExport}
            />
          ),
          primaryAction: {
            label: 'Sell gift card',
            mobileLabel: 'Sell',
            onClick: () => openCheckout({ sellGiftCard: true }),
          },
          isLoading,
          isError,
          errorMessage: error?.message ?? "Couldn't load gift cards",
          empty: {
            icon: Gift,
            title: 'No gift cards sold yet',
            description: 'Gift cards sold to clients will appear here.',
          },
        }}
      />
    </>
  );
}
