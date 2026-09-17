import type { z } from 'zod';
import {
  campaignStepSchema,
  customizeAdStepSchema,
  detailsStepSchema,
  selectVideoOnlyStepSchema,
} from '../-schema';
import type { AdWizardFormData } from '../-schema';

export interface WizardStep {
  id: string;
  schema: z.ZodSchema;
  showIf?: (
    data: Partial<AdWizardFormData>,
    context?: { selectedCampaignFollowUpType?: string }
  ) => boolean;
}

// Three-step ad flow. When the campaign is already chosen (launched from a
// campaign), the `campaign` step is skipped, leaving exactly: Details →
// Content → Preview. Page lives in Details; placement defaults to Facebook and
// the lead form is inherited from the campaign, so neither is a step.
const ALL_STEPS: WizardStep[] = [
  { id: 'campaign', schema: campaignStepSchema },
  { id: 'details', schema: detailsStepSchema },
  { id: 'select-media', schema: selectVideoOnlyStepSchema },
  { id: 'customize', schema: customizeAdStepSchema },
];

export function getActiveSteps(
  data: Partial<AdWizardFormData>,
  context?: {
    selectedCampaignFollowUpType?: string;
    /** When campaign is already chosen (e.g. mobile from campaign detail). */
    skipCampaign?: boolean;
  }
): WizardStep[] {
  return ALL_STEPS.filter((s) => {
    if (context?.skipCampaign && s.id === 'campaign') {
      return false;
    }
    return !s.showIf || s.showIf(data, context);
  });
}
