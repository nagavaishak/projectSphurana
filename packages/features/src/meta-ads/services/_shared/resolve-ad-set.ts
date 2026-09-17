import { metaCampaignConfig } from '@borradh-workspace/database';
import type { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { AdErrorCodes } from '../../models/index.js';

/**
 * Resolve an ad set ID for a given Meta campaign.
 *
 * Only allows campaigns created in Borradh with a chatbot or lead_form
 * follow-up type — both create a fully-configured ad set (with a compatible
 * optimization goal) at campaign-creation time. Non-Borradh campaigns and
 * other follow-up types are rejected to avoid Meta API errors with
 * incompatible optimization goals.
 */
const AD_LAUNCH_SUPPORTED_FOLLOW_UP_TYPES = ['chatbot', 'lead_form'] as const;
export const resolveAdSet = async (
  db: DbConnection,
  metaService: MetaAdsService,
  metaCampaignId: string
): Promise<Result<string>> => {
  // 1. Check metaCampaignConfig — only campaigns created in Borradh have this
  const config = await db.query.metaCampaignConfig.findFirst({
    where: eq(metaCampaignConfig.metaCampaignId, metaCampaignId),
    columns: { metaAdSetId: true, followUpType: true },
  });

  if (!config) {
    return err(
      new FeatureError(
        AdErrorCodes.CAMPAIGN_NOT_FOUND,
        'This campaign was not created in Borradh. Please create a new campaign to launch ads.'
      )
    );
  }

  if (
    !config.followUpType ||
    !AD_LAUNCH_SUPPORTED_FOLLOW_UP_TYPES.includes(
      config.followUpType as (typeof AD_LAUNCH_SUPPORTED_FOLLOW_UP_TYPES)[number]
    )
  ) {
    return err(
      new FeatureError(
        AdErrorCodes.META_AD_CREATE_FAILED,
        'This campaign type does not support launching ads yet. Please create a chatbot or lead form campaign.'
      )
    );
  }

  if (config.metaAdSetId) {
    return ok(config.metaAdSetId);
  }

  // Fallback: campaign was created in Borradh but has no stored ad set ID
  // Fetch from Meta API
  const adSets = await metaService.listAdSets(metaCampaignId);

  const active = adSets.find(
    (s) => s.effectiveStatus === 'ACTIVE' || s.status === 'ACTIVE'
  );
  if (active) return ok(active.id);

  if (adSets.length > 0) return ok(adSets[0].id);

  return err(
    new FeatureError(
      AdErrorCodes.CAMPAIGN_NOT_FOUND,
      'No ad set found for this campaign. The campaign may need to be recreated.'
    )
  );
};
