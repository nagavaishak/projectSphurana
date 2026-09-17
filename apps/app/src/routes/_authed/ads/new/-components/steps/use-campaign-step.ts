import { useGetMetaIntegration } from '@/features/integrations/api';
import { campaignHasBudget, useListCampaigns } from '@/features/meta-campaigns';
import { getCurrencySymbol } from '@/features/meta-campaigns/components/create-campaign-form';
import { useEffect, useMemo } from 'react';
import { useFormContext } from 'react-hook-form';

import { useAdWizard } from '../../-context';
import type { AdWizardFormData } from '../../-schema';

/**
 * Shared core of the ad-wizard campaign step. `CampaignStep` (desktop select)
 * and `AdMobileCampaign` (mobile card list) are two presentations of this —
 * the list filtering, the currency symbol, the campaign→context config sync and
 * the budget label all live here so the two can't drift.
 */
export function useCampaignStep() {
  const { setValue, watch } = useFormContext<AdWizardFormData>();
  const { setSelectedCampaignFollowUpType, setSelectedCampaignConfig } =
    useAdWizard();

  // `isError` is deliberately carried through. `useListCampaigns` returns
  // `campaigns: query.data?.campaigns ?? []`, so a FAILED request and an org
  // with genuinely no campaigns both arrive here as an empty array. Dropping
  // `isError` made the two indistinguishable, and the step then told a clinic
  // that HAS campaigns to "create a campaign first".
  const { campaigns, isLoading, isError, refetch } = useListCampaigns();
  const { integration, availableAdAccounts } = useGetMetaIntegration();

  const currencySymbol = useMemo(() => {
    const adAccountId = integration?.adAccountId;
    const account = availableAdAccounts.find(
      (acc) => acc.id === adAccountId || acc.accountId === adAccountId
    );
    return getCurrencySymbol(account?.currency ?? 'EUR');
  }, [integration?.adAccountId, availableAdAccounts]);

  const selectedCampaignId = watch('campaignId');

  // Only show campaigns created in Borradh (have a local config with followUpType)
  const borradhCampaigns = useMemo(
    () => campaigns.filter((c) => !!c.followUpType),
    [campaigns]
  );

  const selectedCampaign = borradhCampaigns.find(
    (c) => c.id === selectedCampaignId
  );

  // Sync campaign config to context whenever the selected campaign resolves
  // (handles preselected campaigns, async campaign list loading, etc.)
  useEffect(() => {
    if (selectedCampaign) {
      setSelectedCampaignFollowUpType(selectedCampaign.followUpType);
      setSelectedCampaignConfig({
        conversionDestination: selectedCampaign.conversionDestination,
      });
    }
  }, [
    selectedCampaign,
    setSelectedCampaignFollowUpType,
    setSelectedCampaignConfig,
  ]);

  const selectCampaign = (id: string) => {
    setValue('campaignId', id, { shouldValidate: true });
  };

  const getBudgetLabel = (campaign: (typeof borradhCampaigns)[number]) => {
    const dailyBudgetNum = campaign.dailyBudget
      ? Number(campaign.dailyBudget)
      : 0;
    const lifetimeBudgetNum = campaign.lifetimeBudget
      ? Number(campaign.lifetimeBudget)
      : 0;
    if (dailyBudgetNum > 0) {
      return `${currencySymbol}${(dailyBudgetNum / 100).toFixed(2)}/day`;
    }
    if (lifetimeBudgetNum > 0) {
      return `${currencySymbol}${(lifetimeBudgetNum / 100).toFixed(2)} lifetime`;
    }
    return 'No budget';
  };

  return {
    campaigns: borradhCampaigns,
    isLoading,
    isError,
    refetch,
    currencySymbol,
    selectedCampaignId,
    selectedCampaign,
    selectCampaign,
    getBudgetLabel,
    hasBudget: campaignHasBudget,
  };
}
