import type { MessagingDestination } from '@borradh-workspace/api-client/types';
import type {
  AdPlacement,
  CallToAction,
  ConversionDestination,
  CreateAdInput,
  FollowUpType,
} from '../types';

/**
 * The subset of ad-wizard form values both surfaces (desktop dialog + mobile
 * funnel) naturally hold. This is the typed INTENT the builders accept — never
 * the wire body. `AdWizardFormData` (the route-level zod schema) structurally
 * satisfies it, so callers pass `form.getValues()` directly.
 */
export interface AdWizardIntent {
  campaignId: string;
  videoId?: string;
  adName: string;
  headline?: string;
  primaryText?: string;
  description?: string;
  callToAction: CallToAction;
  destinationUrl?: string;
  serviceIds: string[];
  adPlacement?: string;
  metaAdsPageId?: string;
  destinations?: MessagingDestination[];
  leadFormId?: string;
}

/**
 * The campaign-derived context the wizard carries alongside the form: the
 * selected campaign's follow-up type and (for chatbot campaigns) its conversion
 * destination. Both surfaces read these from `useAdWizard()`.
 */
export interface AdCampaignContext {
  followUpType: string | undefined;
  conversionDestination?: string | null;
}

/**
 * Normalize the campaign context into the follow-up fields the wire body needs.
 * Lead-form is the default; conversionDestination only rides along for chatbot
 * campaigns.
 */
export function resolveAdFollowUp(context: AdCampaignContext): {
  followUpType: FollowUpType;
  conversionDestination: ConversionDestination | undefined;
} {
  const followUpType = (context.followUpType as FollowUpType) || 'lead_form';
  const conversionDestination =
    followUpType === 'chatbot'
      ? (context.conversionDestination as ConversionDestination | undefined) ||
        undefined
      : undefined;
  return { followUpType, conversionDestination };
}

/**
 * THE create-ad payload builder. Both the desktop ad wizard and the mobile ad
 * wizard save-as-draft through this function, which is what the payload-parity
 * test pins: identical form data + context → identical mutation payload.
 */
export function buildCreateAdPayload(
  data: AdWizardIntent,
  context: AdCampaignContext
): CreateAdInput {
  const { followUpType, conversionDestination } = resolveAdFollowUp(context);

  return {
    metaCampaignId: data.campaignId,
    videoId: data.videoId || '',
    name: data.adName,
    headline: data.headline || undefined,
    primaryText: data.primaryText || undefined,
    description: data.description || undefined,
    callToAction: data.callToAction,
    destinationUrl: data.destinationUrl || undefined,
    followUpType,
    leadFormId: data.leadFormId || undefined,
    serviceIds: data.serviceIds,
    adPlacement: (data.adPlacement as AdPlacement) || 'facebook',
    conversionDestination,
    metaAdsPageId: data.metaAdsPageId || undefined,
  };
}
