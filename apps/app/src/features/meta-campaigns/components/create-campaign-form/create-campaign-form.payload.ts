import type { CreateCampaignInput } from '@borradh-workspace/api-client/types';
import type { MessagingDestination } from '@borradh-workspace/api-client/types';

import {
  type CreateCampaignFormData,
  forcesEngagement,
} from './create-campaign-form.schema';

/**
 * Meta objective for a set of form answers.
 *
 * Lead-form campaigns are always OUTCOME_LEADS. Chatbot campaigns follow the
 * user's optimization choice, except when WhatsApp is a destination — Meta
 * rejects Lead Generation there, so Engagement is forced.
 */
export function resolveCampaignObjective(
  data: Pick<
    CreateCampaignFormData,
    'followUpType' | 'optimizationMode' | 'destinations'
  >
): 'OUTCOME_LEADS' | 'OUTCOME_ENGAGEMENT' {
  if (data.followUpType !== 'chatbot') return 'OUTCOME_LEADS';
  if (forcesEngagement(data.destinations)) return 'OUTCOME_ENGAGEMENT';
  return data.optimizationMode === 'engagement'
    ? 'OUTCOME_ENGAGEMENT'
    : 'OUTCOME_LEADS';
}

/**
 * THE payload builder. Both the desktop dialog and the mobile funnel submit
 * through this function (via `useCreateCampaignForm`), which is what the
 * payload-parity test pins: identical form data → identical mutation payload.
 */
export function buildCreateCampaignPayload(
  data: CreateCampaignFormData,
  context: { metaAdsPageId: string }
): CreateCampaignInput {
  const isChatbot = data.followUpType === 'chatbot';

  return {
    name: data.name,
    objective: resolveCampaignObjective(data),
    dailyBudget: Math.round(Number.parseFloat(data.dailyBudget) * 100),
    metaAdsPageId: context.metaAdsPageId,
    followUpType: data.followUpType,
    conversionDestination: isChatbot ? 'messenger' : undefined,
    destinations:
      isChatbot && data.destinations.length > 0
        ? (data.destinations as MessagingDestination[])
        : undefined,
    leadFormId: data.followUpType === 'lead_form' ? data.leadFormId : undefined,
    targeting: {
      location: data.targetingLocation,
      latitude: data.targetingLatitude,
      longitude: data.targetingLongitude,
      distanceKm: data.targetingDistanceKm,
      ageMin: 18,
      ageMax: 65,
    },
  } as CreateCampaignInput;
}
