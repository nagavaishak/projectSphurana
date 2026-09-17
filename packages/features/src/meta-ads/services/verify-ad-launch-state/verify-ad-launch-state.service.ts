import type { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type AdLaunchState,
  type VerifyAdLaunchStateInput,
  verifyAdLaunchStateSchema,
} from './verify-ad-launch-state.schema.js';

export interface VerifyAdLaunchStateData {
  /** Honest-state union (ADR-005) derived ONLY from the Meta read-back. */
  state: AdLaunchState;
  /** Raw `effective_status` Meta reported for the ad, null when unverified. */
  adEffectiveStatus: string | null;
  /** Raw `effective_status` Meta reported for the parent campaign. */
  campaignEffectiveStatus: string | null;
  /**
   * One truthful sentence for tool results / cards. Contains no optimistic
   * copy — every claim in it is backed by the read-back.
   */
  detail: string;
}

/**
 * Local ad-row status for a verified launch state. Mirrors
 * `mapMetaAdStatus` semantics so the row and the reported state agree.
 */
export const localStatusForLaunchState = (
  state: AdLaunchState
): 'active' | 'paused' | 'pending' | 'rejected' | 'error' => {
  switch (state) {
    case 'live':
      return 'active';
    case 'live_but_campaign_paused':
    case 'paused_at_meta':
      return 'paused';
    case 'pending_review':
    case 'unverified':
      return 'pending';
    case 'rejected':
      return 'rejected';
    case 'failed':
      return 'error';
  }
};

const detailFor = (
  state: AdLaunchState,
  adEffectiveStatus: string | null,
  campaignEffectiveStatus: string | null
): string => {
  switch (state) {
    case 'live':
      return 'Verified with Meta: the ad is active and its campaign is delivering.';
    case 'live_but_campaign_paused':
      return 'Verified with Meta: the ad is approved, but its campaign is PAUSED — nothing is delivering until the campaign is resumed.';
    case 'pending_review':
      return 'Verified with Meta: the ad is in Meta review. It is not live yet and will not deliver until Meta approves it.';
    case 'paused_at_meta':
      return `Verified with Meta: the ad is not delivering (Meta reports ${adEffectiveStatus ?? 'PAUSED'}).`;
    case 'rejected':
      return 'Verified with Meta: the ad was rejected by Meta review and is not running.';
    case 'failed':
      return `Verified with Meta: the ad is not running (Meta reports ${adEffectiveStatus ?? 'an issue'}).`;
    case 'unverified':
      return `The request was submitted, but the read-back from Meta failed — the ad's real status is unknown and it must not be reported as live.${
        campaignEffectiveStatus
          ? ` (Campaign reports ${campaignEffectiveStatus}.)`
          : ''
      }`;
  }
};

const CAMPAIGN_DELIVERING_STATUSES = new Set(['ACTIVE', 'IN_PROCESS']);

const stateFromStatuses = (
  adEffectiveStatus: string,
  campaignEffectiveStatus: string | null
): AdLaunchState => {
  switch (adEffectiveStatus) {
    case 'ACTIVE':
      // The ad itself is fine — but an ad "live" inside a paused campaign
      // delivers nothing (#105). Meta usually reports CAMPAIGN_PAUSED on the
      // ad in that case, but the parent check catches the races it doesn't.
      return campaignEffectiveStatus &&
        !CAMPAIGN_DELIVERING_STATUSES.has(campaignEffectiveStatus)
        ? 'live_but_campaign_paused'
        : 'live';
    case 'CAMPAIGN_PAUSED':
      return 'live_but_campaign_paused';
    case 'PENDING_REVIEW':
    case 'IN_PROCESS':
    case 'PREAPPROVED':
      return 'pending_review';
    case 'PAUSED':
    case 'ADSET_PAUSED':
    case 'ARCHIVED':
      return 'paused_at_meta';
    case 'DISAPPROVED':
      return 'rejected';
    default:
      // WITH_ISSUES, DELETED, and anything unrecognised: not delivering and
      // not honestly describable as anything but failed.
      return 'failed';
  }
};

/**
 * Internal implementation
 */
const verifyAdLaunchStateImpl = async (
  metaService: MetaAdsService,
  input: VerifyAdLaunchStateInput
): Promise<Result<VerifyAdLaunchStateData>> => {
  const parsed = verifyAdLaunchStateSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { metaAdId, metaCampaignId } = parsed.data;

  // Read both in parallel; each failure degrades independently. A campaign
  // read failure with a successful ad read still yields a truthful (if less
  // precise) state; an ad read failure is always `unverified`.
  const [adSettled, campaignSettled] = await Promise.allSettled([
    metaService.getAd(metaAdId),
    metaService.getCampaign(metaCampaignId),
  ]);

  const campaignEffectiveStatus =
    campaignSettled.status === 'fulfilled'
      ? (campaignSettled.value?.effectiveStatus ??
        campaignSettled.value?.status ??
        null)
      : null;

  if (adSettled.status === 'rejected') {
    // The mutation may well have succeeded — but we could not verify it.
    // Never fabricate `live` here (the false-success class, #105 #138 #201).
    logError('metaAds.verifyAdLaunchState', adSettled.reason, {
      feature: 'meta-ads',
      extra: { metaAdId, metaCampaignId },
    });
    const state: AdLaunchState = 'unverified';
    return ok({
      state,
      adEffectiveStatus: null,
      campaignEffectiveStatus,
      detail: detailFor(state, null, campaignEffectiveStatus),
    });
  }

  if (campaignSettled.status === 'rejected') {
    logError('metaAds.verifyAdLaunchState.campaign', campaignSettled.reason, {
      feature: 'meta-ads',
      extra: { metaAdId, metaCampaignId },
    });
  }

  const adEffectiveStatus =
    adSettled.value?.effectiveStatus ?? adSettled.value?.status ?? null;

  if (!adEffectiveStatus) {
    const state: AdLaunchState = 'unverified';
    return ok({
      state,
      adEffectiveStatus: null,
      campaignEffectiveStatus,
      detail: detailFor(state, null, campaignEffectiveStatus),
    });
  }

  const state = stateFromStatuses(adEffectiveStatus, campaignEffectiveStatus);
  return ok({
    state,
    adEffectiveStatus,
    campaignEffectiveStatus,
    detail: detailFor(state, adEffectiveStatus, campaignEffectiveStatus),
  });
};

/**
 * Read back an ad's `effective_status` AND its parent campaign's status from
 * Meta after any launch/pause/resume/budget mutation, and fold them into the
 * honest-state union. This is the ONLY sanctioned source for post-mutation
 * status claims — services must persist and tools must report this value,
 * never the intent they sent (`'ACTIVE'` literals are the false-success bug).
 */
export const verifyAdLaunchState = (
  metaService: MetaAdsService,
  input: VerifyAdLaunchStateInput
) =>
  trackedResult(
    'metaAds.verifyAdLaunchState',
    () => verifyAdLaunchStateImpl(metaService, input),
    {
      properties: {
        metaAdId: input.metaAdId,
        metaCampaignId: input.metaCampaignId,
      },
    }
  );

export type VerifyAdLaunchStateResult = Awaited<
  ReturnType<typeof verifyAdLaunchState>
>;
