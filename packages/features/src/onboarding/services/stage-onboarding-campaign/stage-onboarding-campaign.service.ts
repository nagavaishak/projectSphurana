import type { OnboardingStagedCampaign } from '@borradh-workspace/database';
import {
  offer,
  onboardingSession,
  organizationService,
  withOrgScope,
} from '@borradh-workspace/database';
import { defaultLeadFormQuestions } from '@borradh-workspace/labels';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { createLeadForm } from '../../../lead-forms/services/create-lead-form/create-lead-form.service.js';
import { resolveNurtureChannel } from '../../../meta-ads/services/_shared/nurture-channel-for-country.js';
import {
  DEFAULT_TARGETING_RADIUS_KM,
  targetingRadiusKmForAreaType,
} from '../../../org-defaults/models/targeting-radius.js';
import { getOrgDefaults } from '../../../org-defaults/services/get-org-defaults/get-org-defaults.service.js';
import { getPrimaryLocation } from '../../../organizations/services/get-primary-location/get-primary-location.service.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type StageOnboardingCampaignInput,
  stageOnboardingCampaignSchema,
} from './stage-onboarding-campaign.schema.js';

/**
 * Fallback daily budget (cents) when the org-defaults read fails entirely.
 * Mirrors Claire's create-campaign default of €15/day — the normal path reads
 * `getOrgDefaults().adDailyBudgetCents` (which itself falls back to the system
 * default), so this only fires on an unexpected defaults failure.
 */
const FALLBACK_DAILY_BUDGET_CENTS = 1500;

/** "4 Jul 2026"-style date part, matching the existing campaign-name style. */
const formatDatePart = (now: Date): string =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(now);

/**
 * Internal implementation.
 *
 * Builds the staged campaign locally: `createCampaign` is an ONLINE Meta call
 * and Meta isn't connected yet at this slide, so everything (name, budget,
 * targeting, nurture channel, a local DRAFT lead-form row) is prepared here
 * and persisted on the session. The launch orchestrator replays the chain
 * after the FLfB popup succeeds.
 */
const stageOnboardingCampaignImpl = async (
  db: DbConnection,
  input: StageOnboardingCampaignInput
): Promise<Result<OnboardingStagedCampaign>> => {
  const parsed = stageOnboardingCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { userId } = parsed.data;

  const session = await withOrgScope(
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

  const { organizationId, offerId, selectedServiceId } = session;
  if (!organizationId || !offerId || !selectedServiceId) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'The campaign cannot be staged yet — pick a service and accept an intro offer first.',
        {
          hasOrganization: !!organizationId,
          hasOffer: !!offerId,
          hasSelectedService: !!selectedServiceId,
        }
      )
    );
  }

  // Name the campaign from the accepted offer / selected service.
  const [offerRow, serviceRow] = await withOrgScope(
    (tx) =>
      Promise.all([
        tx.query.offer.findFirst({
          where: eq(offer.id, offerId),
          columns: { id: true, name: true },
        }),
        tx.query.organizationService.findFirst({
          where: eq(organizationService.id, selectedServiceId),
          columns: { id: true, name: true },
        }),
      ]),
    { db }
  );

  const now = new Date();
  const nameBase =
    offerRow?.name?.trim() || serviceRow?.name?.trim() || 'Intro Offer';
  const name = `${nameBase} — ${formatDatePart(now)}`;

  // Budget default + targeting radius come from org defaults (same chain as
  // Claire's create-campaign tool: explicit request → org default → system
  // default, with a €15/day last-resort fallback).
  let dailyBudgetCents = parsed.data.dailyBudgetCents ?? null;
  let distanceKm = DEFAULT_TARGETING_RADIUS_KM;
  const defaultsResult = await getOrgDefaults(db, { organizationId });
  if (defaultsResult.success) {
    if (
      dailyBudgetCents === null &&
      defaultsResult.data.adDailyBudgetCents != null
    ) {
      dailyBudgetCents = defaultsResult.data.adDailyBudgetCents;
    }
    distanceKm = targetingRadiusKmForAreaType(defaultsResult.data.adAreaType);
  }
  if (dailyBudgetCents === null) {
    dailyBudgetCents = FALLBACK_DAILY_BUDGET_CENTS;
  }

  // Targeting anchors on the org's primary location (created by the analysis
  // slide). We stage the branch ID and a display label — NOT coordinates: the
  // launcher resolves the live branch, so an address corrected between staging
  // and launch is the one that gets targeted.
  const locationResult = await getPrimaryLocation(db, { organizationId });
  const location = locationResult.success ? locationResult.data : null;

  const targeting: OnboardingStagedCampaign['targeting'] = { distanceKm };
  if (location) {
    targeting.locationId = location.id;
    targeting.location = location.label;
  }

  // Nurture channel is country-driven. Pre-connect there is no usable
  // WhatsApp integration yet (WhatsApp connects AFTER Meta), so degrade
  // hasUsableWhatsApp to false — UK/IE orgs land on Messenger with the flag,
  // matching resolveNurtureChannel's documented fallback.
  const nurture = resolveNurtureChannel({
    countryCode: location?.country ?? null,
    hasUsableWhatsApp: false,
  });

  // Create the local DRAFT lead-form row (syncToMeta: false — syncing needs a
  // Meta connection). Re-staging reuses the previously created draft form.
  let leadFormId = session.stagedCampaign?.leadFormId;
  if (!leadFormId) {
    const hh = now.getHours().toString().padStart(2, '0');
    const mm = now.getMinutes().toString().padStart(2, '0');
    const leadFormResult = await createLeadForm(db, {
      organizationId,
      name: `${nameBase} — Lead form — ${formatDatePart(now)} ${hh}:${mm}`,
      questions: defaultLeadFormQuestions,
      followUpChannel: nurture.channel,
      createdById: userId,
      // Privacy policy intentionally omitted — createLeadForm resolves the
      // org fallback chain (dedicated policy → website → Facebook Page).
      syncToMeta: false,
    });
    if (!leadFormResult.success) {
      // trackedResult widens the error shape — rewrap so the caller gets the
      // original code/message (e.g. the privacy-policy VALIDATION_ERROR).
      return err(
        new FeatureError(
          leadFormResult.error.code,
          leadFormResult.error.message,
          leadFormResult.error.details
        )
      );
    }
    leadFormId = leadFormResult.data.id;
  }

  const stagedCampaign: OnboardingStagedCampaign = {
    name,
    dailyBudgetCents,
    targeting,
    leadFormId,
    nurtureChannel: nurture.channel,
    launchProgress: 'not_started',
  };

  await withOrgScope(
    (tx) =>
      tx
        .update(onboardingSession)
        .set({ stagedCampaign })
        .where(eq(onboardingSession.id, session.id)),
    { db }
  );

  return ok(stagedCampaign);
};

/**
 * Stage the onboarding campaign locally so the post-FLfB-connect launch
 * orchestrator can replay it against Meta.
 */
export const stageOnboardingCampaign = (
  db: DbConnection,
  input: StageOnboardingCampaignInput
) =>
  trackedResult(
    'onboarding.stageOnboardingCampaign',
    () => stageOnboardingCampaignImpl(db, input),
    { properties: { userId: input.userId } }
  );

export type StageOnboardingCampaignResult = Awaited<
  ReturnType<typeof stageOnboardingCampaign>
>;
