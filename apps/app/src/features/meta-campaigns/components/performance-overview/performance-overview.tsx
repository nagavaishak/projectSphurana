import { useGetMetaIntegration } from '@/features/integrations/api';
import {
  DollarSign,
  Eye,
  MousePointer,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { useMemo } from 'react';
import type { CampaignInsightsTotals } from '../../api/types';
import { MetricsCard } from '../metrics-card';

interface PerformanceOverviewProps {
  insights: CampaignInsightsTotals | null;
  isLoading?: boolean;
}

function formatNumber(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toLocaleString();
}

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

export function PerformanceOverview({
  insights,
  isLoading = false,
}: PerformanceOverviewProps) {
  const { integration, availableAdAccounts } = useGetMetaIntegration();
  const currencySymbol = useMemo(() => {
    const adAccountId = integration?.adAccountId;
    const account = availableAdAccounts.find(
      (acc) => acc.id === adAccountId || acc.accountId === adAccountId
    );
    return getCurrencySymbol(account?.currency ?? 'EUR');
  }, [integration?.adAccountId, availableAdAccounts]);

  const formatCurrency = (cents: number): string =>
    `${currencySymbol}${(cents / 100).toFixed(2)}`;
  const metrics = [
    {
      label: 'Impressions',
      value: insights ? formatNumber(insights.impressions) : '-',
      icon: Eye,
      iconColor: 'text-blue-500',
    },
    {
      label: 'Clicks',
      value: insights ? formatNumber(insights.clicks) : '-',
      icon: MousePointer,
      iconColor: 'text-green-500',
    },
    {
      label: 'Leads',
      value: insights ? formatNumber(insights.leads) : '-',
      icon: Users,
      iconColor: 'text-purple-500',
    },
    {
      label: 'Cost Per Lead',
      value:
        insights && insights.leads > 0
          ? formatCurrency(Math.round(insights.spend / insights.leads))
          : '-',
      icon: DollarSign,
      iconColor: 'text-orange-500',
    },
    {
      label: 'Conversions',
      value: insights ? formatNumber(insights.conversions) : '-',
      icon: TrendingUp,
      iconColor: 'text-emerald-500',
    },
    {
      label: 'Total Spend',
      value: insights ? formatCurrency(insights.spend) : '-',
      icon: Wallet,
      iconColor: 'text-red-500',
    },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Performance Overview</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {metrics.map((metric) => (
          <MetricsCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            icon={metric.icon}
            iconColor={metric.iconColor}
            isLoading={isLoading}
          />
        ))}
      </div>
    </div>
  );
}
