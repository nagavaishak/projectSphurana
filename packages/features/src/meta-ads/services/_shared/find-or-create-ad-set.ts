import type {
  MessagingDestination,
  MetaTargeting,
} from '@borradh-workspace/database';
import { metaCampaignConfig } from '@borradh-workspace/database';
import type { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  FeatureError,
  type Result,
  buildMetaTargeting,
  err,
  ok,
} from '../../../shared/index.js';
import { AdErrorCodes } from '../../models/index.js';
import { lookupWhatsAppForDestinations } from './lookup-whatsapp-for-destinations.js';
import {
  type MetaDestinationType,
  resolveDestinationType,
} from './map-conversion-destination.js';

interface FindOrCreateAdSetOptions {
  db: DbConnection;
  metaService: MetaAdsService;
  metaCampaignId: string;
  organizationId: string;
  destinations: MessagingDestination[];
  campaignObjective: string;
  pageId: string;
  adSetNameHint: string;
  optimizationGoalOverride?: 'CONVERSATIONS' | 'LINK_CLICKS';
}

/**
 * Find an existing Meta ad set under the given campaign whose
 * `destination_type` matches the one resolved from the ad's destinations,
 * or create a new ad set if none exists. This is how Borradh emulates
 * per-ad destinations on top of Meta's ad-set-level `destination_type`
 * constraint (ads within an ad set must share a destination).
 *
 * - Matching ad sets are reused so Meta's learning accrues across ads.
 * - Archived/deleted ad sets are ignored when searching.
 * - The campaign's stored targeting (from `metaCampaignConfig`) is used
 *   for new ad sets so per-destination ad sets inherit the user-chosen
 *   audience.
 */
export const findOrCreateAdSet = async (
  options: FindOrCreateAdSetOptions
): Promise<
  Result<{ metaAdSetId: string; destinationType: MetaDestinationType }>
> => {
  const {
    db,
    metaService,
    metaCampaignId,
    organizationId,
    destinations,
    campaignObjective,
    pageId,
    adSetNameHint,
    optimizationGoalOverride,
  } = options;

  let destinationType: MetaDestinationType;
  try {
    destinationType = resolveDestinationType({
      destinations,
      objective: campaignObjective,
    });
  } catch (error) {
    return err(
      new FeatureError(
        AdErrorCodes.META_AD_CREATE_FAILED,
        error instanceof Error
          ? error.message
          : 'Unable to resolve a Meta destination type for the selected destinations.'
      )
    );
  }

  // Look up the org's WhatsApp account when whatsapp is in the mix — this
  // also surfaces disconnected/expired WABA errors before we hit Meta.
  const waResult = await lookupWhatsAppForDestinations(
    db,
    organizationId,
    destinations
  );
  if (!waResult.success) return waResult;
  // Meta returns `display_phone_number` formatted for humans ("+1 555-555-5555").
  // `promoted_object.whatsapp_phone_number` requires clean E.164 — anything
  // else is rejected with "phone number is not linked to a WhatsApp Business
  // account". Strip all non-digits except the leading +.
  const whatsappPhoneNumber = waResult.data?.phoneNumber
    ? `+${waResult.data.phoneNumber.replace(/\D/g, '')}`
    : undefined;

  // Step 1: try to reuse an existing ad set with a matching destination_type.
  const existingAdSets = await metaService.listAdSets(metaCampaignId);
  const reusable = existingAdSets.find((adSet) => {
    if (adSet.destinationType !== destinationType) return false;
    const effective = adSet.effectiveStatus ?? adSet.status;
    return effective !== 'ARCHIVED' && effective !== 'DELETED';
  });

  if (reusable) {
    return ok({ metaAdSetId: reusable.id, destinationType });
  }

  // Step 2: no match — create a new ad set. Copy targeting from the
  // campaign config so the new ad set inherits the user's audience.
  const config = await db.query.metaCampaignConfig.findFirst({
    where: eq(metaCampaignConfig.metaCampaignId, metaCampaignId),
    columns: { targeting: true },
  });

  if (!config) {
    return err(
      new FeatureError(
        AdErrorCodes.CAMPAIGN_NOT_FOUND,
        'This campaign was not created in Borradh. Please create a new campaign to launch ads.'
      )
    );
  }

  const targeting: MetaTargeting = (config.targeting ?? {}) as MetaTargeting;

  // OUTCOME_LEADS → LEAD_GENERATION; anything else messaging-related
  // optimizes for conversations unless the caller overrides (e.g. EU
  // WhatsApp ads need LINK_CLICKS).
  const optimizationGoal =
    campaignObjective === 'OUTCOME_LEADS'
      ? 'LEAD_GENERATION'
      : (optimizationGoalOverride ?? 'CONVERSATIONS');

  // Meta errors propagate — the caller wraps this in a try/catch and
  // routes exceptions through handleMetaError for consistent mapping.
  const metaAdSetId = await metaService.createAdSet({
    name: `${adSetNameHint} - ${destinationType}`,
    campaignId: metaCampaignId,
    status: 'PAUSED',
    billingEvent: 'IMPRESSIONS',
    optimizationGoal,
    targeting: buildMetaTargeting(targeting),
    destinationType,
    promotedObject: {
      pageId,
      ...(whatsappPhoneNumber && { whatsappPhoneNumber }),
    },
    dsaBeneficiary: pageId,
    dsaPayor: pageId,
  });

  return ok({ metaAdSetId, destinationType });
};
