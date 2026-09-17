import type { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { createLogger } from '@borradh-workspace/observability';
import { type Result, ok } from '../../../shared/index.js';
import {
  type VerifyAdLaunchStateData,
  verifyAdLaunchState,
} from '../verify-ad-launch-state/index.js';

const logger = createLogger('MetaAds');

/**
 * Activate a campaign, ad set, and ad on Meta, then READ BACK the resulting
 * state and fetch the permalink.
 *
 * Extracted from finalize-ad, publish-ad, and launch-ad-from-post where
 * this activation sequence was duplicated.
 *
 * The three `status: 'ACTIVE'` updates are requests, not outcomes: Meta may
 * leave the ad in PENDING_REVIEW, reject it, or keep the campaign paused.
 * Callers must persist and report `launch` (the verified read-back, ADR-005),
 * never assume the ad went live because these calls returned.
 */
export const activateAdOnMeta = async (
  metaService: MetaAdsService,
  input: {
    metaCampaignId: string;
    metaAdSetId: string;
    metaAdId: string;
  }
): Promise<
  Result<{ permalink: string | null; launch: VerifyAdLaunchStateData }>
> => {
  const { metaCampaignId, metaAdSetId, metaAdId } = input;

  await metaService.updateCampaign(metaCampaignId, { status: 'ACTIVE' });
  await metaService.updateAdSet(metaAdSetId, { status: 'ACTIVE' });
  await metaService.updateAd(metaAdId, { status: 'ACTIVE' });

  let permalink: string | null = null;
  try {
    permalink = await metaService.getAdPermalink(metaAdId);
  } catch {
    // Non-critical — activation was submitted; state is verified below.
    logger.warn(`Could not fetch permalink for ad ${metaAdId}`);
  }

  const verifyResult = await verifyAdLaunchState(metaService, {
    metaAdId,
    metaCampaignId,
  });
  const launch: VerifyAdLaunchStateData = verifyResult.success
    ? verifyResult.data
    : {
        state: 'unverified',
        adEffectiveStatus: null,
        campaignEffectiveStatus: null,
        detail:
          'Activation was submitted, but the read-back from Meta failed — the ad must not be reported as live until verified.',
      };

  return ok({ permalink, launch });
};
