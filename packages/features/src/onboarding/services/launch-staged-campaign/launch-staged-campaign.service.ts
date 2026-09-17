import type {
  OnboardingSession,
  OnboardingStagedCampaign,
} from '@borradh-workspace/database';
import {
  metaAdsIntegration,
  onboardingSession,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { syncLeadFormToMeta } from '../../../lead-forms/services/sync-lead-form-to-meta/sync-lead-form-to-meta.service.js';
import { AdErrorCodes } from '../../../meta-ads/models/index.js';
import { createAd } from '../../../meta-ads/services/create-ad/create-ad.service.js';
import { publishAd } from '../../../meta-ads/services/publish-ad/publish-ad.service.js';
import type { CreateCampaignInput } from '../../../meta-campaigns/services/create-campaign/create-campaign.schema.js';
import { createCampaign } from '../../../meta-campaigns/services/create-campaign/create-campaign.service.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type LaunchStagedCampaignInput,
  type LaunchStagedCampaignStep,
  launchStagedCampaignSchema,
} from './launch-staged-campaign.schema.js';

/** Neutral defaults matching the create-campaign modal / Claire tool. */
const DEFAULT_AGE_MIN = 18;
const DEFAULT_AGE_MAX = 65;

/**
 * The staged campaign plus the orchestrator's own bookkeeping: the draft ad
 * ids created in step (c), persisted after EACH create so a crash mid-step
 * resumes from the next ad rather than duplicating drafts.
 */
type StagedCampaignState = OnboardingStagedCampaign & { adIds?: string[] };

const PROGRESS_ORDER = [
  'not_started',
  'campaign_created',
  'lead_form_synced',
  'ads_created',
  'launched',
] as const;

const progressRank = (
  progress: OnboardingStagedCampaign['launchProgress']
): number => PROGRESS_ORDER.indexOf(progress ?? 'not_started');

export interface LaunchStagedCampaignResponse {
  metaCampaignId: string;
  adIds: string[];
  launchProgress: 'launched';
  launchedAt: Date;
}

/**
 * Internal implementation — THE post-FLfB-connect launch orchestrator.
 *
 * Replays the locally staged campaign against Meta, step by step:
 *   a. createCampaign          → 'campaign_created' (+ session.metaCampaignId)
 *   b. syncLeadFormToMeta      → 'lead_form_synced'
 *   c. createAd ×3 drafts      → 'ads_created' (2 picked graphics + 1 video)
 *   d. publishAd for each      → 'launched' (+ session.launchedAt)
 *
 * `stagedCampaign.launchProgress` is updated after EACH completed step so a
 * crash/retry RESUMES instead of double-launching: completed steps are
 * skipped on re-entry. Step (d) publishes the drafts created in (c) —
 * `publishAd` is the "activate an existing draft" primitive (it also flips
 * the campaign + ad set to ACTIVE — real spend, owner-confirmed).
 *
 * CRITICAL: no DB transaction is ever held across a Meta call — each
 * progress write is its own short update.
 */
const launchStagedCampaignImpl = async (
  db: DbConnection,
  input: LaunchStagedCampaignInput
): Promise<Result<LaunchStagedCampaignResponse>> => {
  const parsed = launchStagedCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { userId } = parsed.data;

  const session: OnboardingSession | null | undefined = await withOrgScope(
    (tx) =>
      tx.query.onboardingSession.findFirst({
        where: eq(onboardingSession.userId, userId),
      }),
    { db }
  );

  if (!session) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Onboarding session not found')
    );
  }

  const staged: StagedCampaignState | null = session.stagedCampaign
    ? { ...session.stagedCampaign }
    : null;
  const { organizationId, selectedServiceId, selectedVideoId } = session;
  const selectedGraphicIds = session.selectedGraphicIds ?? [];

  if (!staged || !staged.leadFormId) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'No staged campaign to launch — stage the campaign first.'
      )
    );
  }
  if (!organizationId || !selectedServiceId) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'The onboarding session is missing its organization or selected service.'
      )
    );
  }
  if (selectedGraphicIds.length !== 2 || !selectedVideoId) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'Pick 2 ad graphics and 1 video before launching.',
        {
          selectedGraphicCount: selectedGraphicIds.length,
          hasSelectedVideo: !!selectedVideoId,
        }
      )
    );
  }

  // The orchestrator runs right after the FLfB popup — require a configured
  // Meta integration before touching any Meta-calling service.
  const integration = await withOrgScope(
    (tx) =>
      tx.query.metaAdsIntegration.findFirst({
        where: eq(metaAdsIntegration.organizationId, organizationId),
        columns: { id: true, configurationStatus: true, tokenStatus: true },
      }),
    { db }
  );
  if (
    !integration ||
    integration.configurationStatus !== 'configured' ||
    integration.tokenStatus !== 'valid'
  ) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        "Meta isn't connected yet — complete the Facebook connect step, then launch.",
        { configured: integration?.configurationStatus ?? null }
      )
    );
  }

  const leadFormId = staged.leadFormId;
  const persistSession = async (
    extra: Partial<typeof onboardingSession.$inferInsert> = {}
  ): Promise<void> => {
    await withOrgScope(
      (tx) =>
        tx
          .update(onboardingSession)
          .set({ stagedCampaign: staged, ...extra })
          .where(eq(onboardingSession.id, session.id)),
      { db }
    );
  };

  const stepError = (
    step: LaunchStagedCampaignStep,
    error: { code: string; message: string }
  ) =>
    err(
      new FeatureError(error.code, error.message, {
        step,
        launchProgress: staged.launchProgress ?? 'not_started',
      })
    );

  // ---- Step a: create the campaign on Meta ------------------------------
  let metaCampaignId = session.metaCampaignId;
  if (progressRank(staged.launchProgress) < progressRank('campaign_created')) {
    // Geo comes from the staged BRANCH, resolved live inside createCampaign.
    //
    // There is deliberately no country fallback here any more. This used to end
    // `else { targeting.countries = ['IE'] }` when no coordinates were staged —
    // which quietly pointed US and UK orgs' first-ever campaign at Ireland.
    // Onboarding has already created the org's location (the analysis slide)
    // and both location write paths geocode, so the branch is the answer; if it
    // genuinely cannot be placed, createCampaign refuses with something the
    // owner can act on rather than spending their money in the wrong country.
    const targeting: CreateCampaignInput['targeting'] = {
      ageMin: DEFAULT_AGE_MIN,
      ageMax: DEFAULT_AGE_MAX,
      distanceKm: staged.targeting?.distanceKm,
    };

    const campaignResult = await createCampaign(db, {
      organizationId,
      name: staged.name,
      objective: 'OUTCOME_LEADS',
      dailyBudget: staged.dailyBudgetCents,
      locationId: staged.targeting?.locationId,
      targeting,
      followUpType: 'lead_form',
      leadFormId,
    });
    if (!campaignResult.success) {
      return stepError('create_campaign', campaignResult.error);
    }

    metaCampaignId = campaignResult.data.metaCampaignId;
    staged.launchProgress = 'campaign_created';
    await persistSession({ metaCampaignId });
  }

  if (!metaCampaignId) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'Launch state is inconsistent — the campaign was marked created but no Meta campaign ID was stored.'
      )
    );
  }

  // ---- Step b: sync the draft lead form to Meta --------------------------
  if (progressRank(staged.launchProgress) < progressRank('lead_form_synced')) {
    const syncResult = await syncLeadFormToMeta(db, { leadFormId });
    if (!syncResult.success) {
      return stepError('sync_lead_form', syncResult.error);
    }
    staged.launchProgress = 'lead_form_synced';
    await persistSession();
  }

  // ---- Step c: create the 3 draft ads (2 graphics + 1 video) -------------
  const creatives: Array<{ graphicId?: string; videoId?: string }> = [
    { graphicId: selectedGraphicIds[0] },
    { graphicId: selectedGraphicIds[1] },
    { videoId: selectedVideoId },
  ];
  const adIds: string[] = staged.adIds ? [...staged.adIds] : [];

  if (progressRank(staged.launchProgress) < progressRank('ads_created')) {
    // Resume mid-step: adIds.length drafts already exist from a prior attempt.
    for (let i = adIds.length; i < creatives.length; i++) {
      const adResult = await createAd(db, {
        metaCampaignId,
        ...creatives[i],
        organizationId,
        name: `${staged.name} — Ad ${i + 1}`,
        callToAction: 'LEARN_MORE',
        followUpType: 'lead_form',
        leadFormId,
        serviceIds: [selectedServiceId],
        adPlacement: 'facebook',
      });
      if (!adResult.success) {
        staged.adIds = adIds;
        await persistSession();
        return stepError('create_ads', adResult.error);
      }
      adIds.push(adResult.data.id);
      staged.adIds = adIds;
      // Persist after EACH draft so a crash resumes at the next creative.
      await persistSession();
    }
    staged.launchProgress = 'ads_created';
    await persistSession();
  }

  // ---- Step d: publish every draft (campaign goes ACTIVE — real spend) ---
  let launchedAt = session.launchedAt;
  if (progressRank(staged.launchProgress) < progressRank('launched')) {
    for (const adId of adIds) {
      const publishResult = await publishAd(db, { adId, organizationId });
      if (
        !publishResult.success &&
        // An ad already published by a prior (crashed) attempt is no longer a
        // draft — publishAd returns INVALID_AD_STATE. Treat it as done.
        publishResult.error.code !== AdErrorCodes.INVALID_AD_STATE
      ) {
        return stepError('launch_ads', publishResult.error);
      }
    }
    staged.launchProgress = 'launched';
    launchedAt = new Date();
    await persistSession({ launchedAt });
  }

  return ok({
    metaCampaignId,
    adIds,
    launchProgress: 'launched',
    launchedAt: launchedAt ?? new Date(),
  });
};

/**
 * Launch the staged onboarding campaign — idempotent and resumable: re-invoke
 * after a failure and completed steps are skipped.
 */
export const launchStagedCampaign = (
  db: DbConnection,
  input: LaunchStagedCampaignInput
) =>
  trackedResult(
    'onboarding.launchStagedCampaign',
    () => launchStagedCampaignImpl(db, input),
    { properties: { userId: input.userId } }
  );

export type LaunchStagedCampaignResult = Awaited<
  ReturnType<typeof launchStagedCampaign>
>;
