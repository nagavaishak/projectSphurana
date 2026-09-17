import type {
  AdCampaignContext,
  AdWizardIntent,
} from '../create-ad/create-ad.payload';
import { resolveAdFollowUp } from '../create-ad/create-ad.payload';
import type { AdPlacement, LaunchAdInput } from '../types';

/**
 * THE launch-ad payload builder. Both the desktop ad wizard and the mobile ad
 * wizard publish through this function, which is what the payload-parity test
 * pins: identical form data + context → identical mutation payload.
 *
 * Launch differs from create only in the chatbot `destinations` multi-select:
 * launch-ad maps the set to Meta's combo destination_type via
 * find-or-create-ad-set. Non-chatbot flows omit it.
 */
export function buildLaunchAdPayload(
  data: AdWizardIntent,
  context: AdCampaignContext
): LaunchAdInput {
  const { followUpType, conversionDestination } = resolveAdFollowUp(context);

  const destinations =
    followUpType === 'chatbot' &&
    data.destinations &&
    data.destinations.length > 0
      ? data.destinations
      : undefined;

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
    destinations,
    metaAdsPageId: data.metaAdsPageId || undefined,
  };
}
