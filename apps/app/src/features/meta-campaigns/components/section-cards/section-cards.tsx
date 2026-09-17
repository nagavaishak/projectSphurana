import { useMemo } from 'react';

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useGetMetaIntegration } from '@/features/integrations';

import { useListCampaignInsights } from '../../api';
import type { CampaignInsightsParams } from '../../api/types';

function getCurrencySymbol(currencyCode: string): string {
  try {
    const parts = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currencyCode,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? currencyCode;
  } catch {
    return currencyCode;
  }
}

/**
 * Aggregate stat cards for the campaigns page. Sums per-campaign insights
 * client-side from the single batched insights request — the same request
 * `CampaignList` uses, so this adds no extra Meta API calls.
 */
export function SectionCards({
  params = {},
}: {
  params?: CampaignInsightsParams;
} = {}) {
  const { insightsByCampaignId, isLoading, isError } =
    useListCampaignInsights(params);
  const { integration, availableAdAccounts } = useGetMetaIntegration();

  const currencySymbol = useMemo(() => {
    const adAccountId = integration?.adAccountId;
    const account = availableAdAccounts.find(
      (acc) => acc.id === adAccountId || acc.accountId === adAccountId
    );
    return getCurrencySymbol(account?.currency ?? 'EUR');
  }, [integration?.adAccountId, availableAdAccounts]);

  const totals = useMemo(() => {
    const acc = { spend: 0, leads: 0, impressions: 0, reach: 0 };
    for (const { totals: t } of insightsByCampaignId.values()) {
      acc.spend += t.spend;
      acc.leads += t.leads;
      acc.impressions += t.impressions;
      acc.reach += t.reach;
    }
    return acc;
  }, [insightsByCampaignId]);

  const cards = [
    {
      label: 'Amount Spent',
      value: `${currencySymbol}${(totals.spend / 100).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`,
    },
    { label: 'Leads', value: totals.leads.toLocaleString() },
    { label: 'Impressions', value: totals.impressions.toLocaleString() },
    { label: 'Reach', value: totals.reach.toLocaleString() },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label} className="@container/card">
          <CardHeader>
            <CardDescription>{card.label}</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {isLoading ? (
                <Skeleton className="h-8 w-28" />
              ) : isError ? (
                '—'
              ) : (
                card.value
              )}
            </CardTitle>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
