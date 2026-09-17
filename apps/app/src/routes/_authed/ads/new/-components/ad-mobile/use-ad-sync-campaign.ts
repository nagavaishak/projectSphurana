import { useListCampaigns } from '@/features/meta-campaigns';
import { useEffect } from 'react';
import type { UseFormSetValue } from 'react-hook-form';

import { useAdWizard } from '../../-context';
import type { AdWizardFormData } from '../../-schema';

/** Sync campaign follow-up config when `campaignId` is set (preselected or form). */
export function useAdSyncCampaign(
  campaignId: string | undefined,
  setValue: UseFormSetValue<AdWizardFormData>
) {
  const { setSelectedCampaignFollowUpType, setSelectedCampaignConfig } =
    useAdWizard();
  const { campaigns } = useListCampaigns();

  useEffect(() => {
    if (!campaignId) return;
    setValue('campaignId', campaignId, { shouldValidate: true });
  }, [campaignId, setValue]);

  const campaign = campaigns.find((c) => c.id === campaignId);

  useEffect(() => {
    if (campaign) {
      setSelectedCampaignFollowUpType(campaign.followUpType);
      setSelectedCampaignConfig({
        conversionDestination: campaign.conversionDestination,
      });
    }
  }, [campaign, setSelectedCampaignFollowUpType, setSelectedCampaignConfig]);

  return { campaign };
}
