import {
  campaignStepSchema,
  customizeAdStepSchema,
  detailsStepSchema,
  selectVideoOnlyStepSchema,
} from '../-schema';
import type { AdWizardFormData } from '../-schema';
import type { WizardStep } from './-steps';

// Mirrors the web 3-step flow: Details → Content → Preview (campaign step is
// skipped when launched from a campaign). Page lives in Details; placement
// defaults to Facebook and the lead form is inherited from the campaign.
const MOBILE_STEPS: WizardStep[] = [
  { id: 'campaign', schema: campaignStepSchema },
  { id: 'details', schema: detailsStepSchema },
  { id: 'select-media', schema: selectVideoOnlyStepSchema },
  { id: 'customize', schema: customizeAdStepSchema },
];

export function getMobileActiveSteps(
  data: Partial<AdWizardFormData>,
  context?: {
    selectedCampaignFollowUpType?: string;
    /** When campaign is already chosen via URL, skip the in-wizard step. */
    skipCampaign?: boolean;
  }
): WizardStep[] {
  return MOBILE_STEPS.filter((s) => {
    if (context?.skipCampaign && s.id === 'campaign') {
      return false;
    }
    return !s.showIf || s.showIf(data, context);
  });
}
