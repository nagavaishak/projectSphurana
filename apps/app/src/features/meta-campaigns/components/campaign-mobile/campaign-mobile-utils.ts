import type { Campaign } from '../../api/types';

export type CampaignPlatformFilterValue =
  | 'all'
  | 'instagram_dm'
  | 'facebook_messenger';

export type CampaignStatusFilterValue = 'all' | 'ACTIVE' | 'PAUSED';

export function campaignMatchesPlatformFilter(
  campaign: Campaign,
  platformFilter: CampaignPlatformFilterValue
): boolean {
  if (platformFilter === 'all') {
    return true;
  }
  if (platformFilter === 'instagram_dm') {
    return campaign.conversionDestination === 'instagram_direct';
  }
  return (
    campaign.conversionDestination === 'messenger' ||
    campaign.followUpType === 'lead_form' ||
    campaign.conversionDestination === 'whatsapp'
  );
}

export function campaignMatchesStatusFilter(
  campaign: Campaign,
  statusFilter: CampaignStatusFilterValue
): boolean {
  if (statusFilter === 'all') {
    return true;
  }
  if (statusFilter === 'ACTIVE') {
    return campaign.effectiveStatus === 'ACTIVE';
  }
  return (
    campaign.effectiveStatus === 'PAUSED' ||
    campaign.effectiveStatus === 'CAMPAIGN_PAUSED' ||
    campaign.effectiveStatus === 'ADSET_PAUSED'
  );
}

export type CampaignDestinationPlatform = 'facebook' | 'instagram' | 'whatsapp';

/** Mirrors web `getDestinationBadges` — one platform per campaign, none when unknown. */
export function getCampaignPlatformBadges(
  campaign: Campaign
): CampaignDestinationPlatform[] {
  if (campaign.followUpType === 'lead_form') {
    return [];
  }

  switch (campaign.conversionDestination) {
    case 'whatsapp':
      return ['whatsapp'];
    case 'messenger':
      return ['facebook'];
    case 'instagram_direct':
      return ['instagram'];
    default:
      return [];
  }
}

export function getCurrencySymbol(currencyCode: string): string {
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

function formatCentsMoney(cents: number, symbol: string): string {
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

/** Daily budget (preferred) or lifetime budget, formatted; null when unset. */
export function getCampaignBudgetLabel(
  campaign: Campaign,
  symbol: string
): string | null {
  const daily = Number(campaign.dailyBudget);
  if (campaign.dailyBudget && !Number.isNaN(daily) && daily > 0) {
    return `${formatCentsMoney(daily, symbol)}/day`;
  }
  const lifetime = Number(campaign.lifetimeBudget);
  if (campaign.lifetimeBudget && !Number.isNaN(lifetime) && lifetime > 0) {
    return formatCentsMoney(lifetime, symbol);
  }
  return null;
}

/**
 * Row metrics line: ad count, budget, and — once insights load — amount spent
 * and lead count. Ads + budget show immediately; spend/leads need insights.
 */
export function getCampaignMetricsLabel(params: {
  campaign: Campaign;
  currencySymbol: string;
  leads: number;
  spend: number;
  insightsReady: boolean;
}): string {
  const { campaign, currencySymbol, leads, spend, insightsReady } = params;

  const adCount = campaign.adCount ?? 0;
  const adsLabel = `${adCount} ${adCount === 1 ? 'ad' : 'ads'}`;
  const budgetLabel = getCampaignBudgetLabel(campaign, currencySymbol);
  const spentLabel =
    insightsReady && spend > 0
      ? `${formatCentsMoney(spend, currencySymbol)} spent`
      : null;
  const leadsLabel =
    insightsReady && leads > 0
      ? `${leads} ${leads === 1 ? 'Lead' : 'Leads'}`
      : null;

  return [adsLabel, budgetLabel, spentLabel, leadsLabel]
    .filter(Boolean)
    .join(' • ');
}
