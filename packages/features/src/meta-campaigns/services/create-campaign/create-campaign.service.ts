import type { MessagingDestination } from '@borradh-workspace/database';
import { metaCampaignConfig, withOrgScope } from '@borradh-workspace/database';
import { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import {
  logError,
  trackOrgEvent,
  trackedResult,
} from '@borradh-workspace/observability';
import { getExperimentVariant } from '../../../experiments/services/get-experiment-variant/get-experiment-variant.service.js';
import {
  handleMetaError,
  logMetaErrorIfUnknown,
} from '../../../meta-ads/services/_shared/handle-meta-error.js';
import {
  type MetaDestinationType,
  resolveDestinationType,
} from '../../../meta-ads/services/_shared/map-conversion-destination.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  buildMetaTargeting,
  err,
  ok,
} from '../../../shared/index.js';
import { CampaignErrorCodes } from '../../models/index.js';
import {
  buildTargetingForLocation,
  campaignHasSiteDestination,
  getMetaCredentials,
  resolveCampaignDestinationUrl,
  resolveCampaignLocation,
} from '../_shared/index.js';
import {
  type CreateCampaignInput,
  createCampaignSchema,
} from './create-campaign.schema.js';

/** Experiment key for testing engagement vs lead generation for messenger campaigns */
const MESSENGER_OBJECTIVE_EXPERIMENT = 'messenger-campaign-objective';

type MetaObjective =
  | 'OUTCOME_AWARENESS'
  | 'OUTCOME_ENGAGEMENT'
  | 'OUTCOME_LEADS'
  | 'OUTCOME_SALES'
  | 'OUTCOME_TRAFFIC';

type OptimizationGoal =
  | 'REACH'
  | 'IMPRESSIONS'
  | 'LINK_CLICKS'
  | 'VIDEO_VIEWS'
  | 'LANDING_PAGE_VIEWS'
  | 'LEAD_GENERATION'
  | 'CONVERSATIONS';

/**
 * Get the optimization goal based on objective
 */
const getOptimizationGoal = (objective: string): OptimizationGoal => {
  const objectiveMap: Record<string, OptimizationGoal> = {
    OUTCOME_AWARENESS: 'REACH',
    OUTCOME_ENGAGEMENT: 'IMPRESSIONS',
    OUTCOME_LEADS: 'LEAD_GENERATION',
    OUTCOME_SALES: 'LINK_CLICKS',
    OUTCOME_TRAFFIC: 'LINK_CLICKS',
  };
  return objectiveMap[objective] || 'REACH';
};

export interface CreateCampaignResponse {
  metaCampaignId: string;
  metaAdSetId: string;
  followUpType: string;
  conversionDestination?: string;
  /**
   * Where this campaign's ads should send clicks: the tenant's microsite
   * booking page, tagged with the campaign's UTMs (plan §9.5).
   *
   * Undefined for chatbot and lead-form campaigns, which have no URL
   * destination. Derived, never stored — the host is re-resolved on read, so a
   * custom-domain move does not strand it.
   */
  destinationUrl?: string;
  /**
   * The branch this campaign targets — resolved server-side from `locationId`
   * or the org default, never from caller-supplied coordinates. Echoed so a
   * confirmation card can name the address the radius is centred on.
   */
  location: { id: string; label: string };
}

/**
 * Internal implementation
 */
const createCampaignImpl = async (
  db: DbConnection,
  input: CreateCampaignInput
): Promise<Result<CreateCampaignResponse>> => {
  const parsed = createCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    name,
    objective,
    dailyBudget,
    lifetimeBudget,
    startDate,
    endDate,
    locationId,
    targeting: targetingKnobs,
    followUpType,
    conversionDestination,
    destinations,
    leadFormId,
    metaAdsPageId,
  } = parsed.data;

  // Geo comes from the campaign's BRANCH, resolved before anything is created
  // on Meta — a campaign we cannot target is one we must not create. The knobs
  // (radius, ages, genders) are the caller's; the coordinates never are.
  const knobs = targetingKnobs ?? {};
  // A national campaign (`countries`) needs the branch for attribution and its
  // landing page, but not for a radius — so an ungeocoded address blocks only
  // the radius case.
  const isNationalTargeting = (knobs.countries?.length ?? 0) > 0;
  const locationResult = await resolveCampaignLocation(db, {
    organizationId,
    locationId,
    requireCoordinates: !isNationalTargeting,
  });
  if (!locationResult.success) return locationResult;
  const campaignLocation = locationResult.data;
  const targeting = buildTargetingForLocation(campaignLocation, knobs);

  // Get Meta credentials (page selection flows through three-tier ad account resolution)
  const credResult = await getMetaCredentials(db, {
    organizationId,
    metaAdsPageId,
  });
  if (!credResult.success) return credResult;

  const { credentials } = credResult.data;
  const metaService = new MetaAdsService(credentials);

  // Validate budget
  if (!dailyBudget && !lifetimeBudget) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'A daily budget or lifetime budget is required to create a campaign on Meta.'
      )
    );
  }

  const isChatbot = followUpType === 'chatbot';
  const isLeadForm = followUpType === 'lead_form';

  // Pre-flight: verify the token still has access to the resolved page (Phase 0.1)
  try {
    const tokenPages = await metaService.getPages();
    const hasAccess = tokenPages.some((p) => p.id === credentials.pageId);
    if (!hasAccess) {
      return err(
        new FeatureError(
          CampaignErrorCodes.META_PAGE_NOT_ACCESSIBLE,
          `Your Meta connection no longer has access to the page "${credResult.data.resolvedPage.pageName || credentials.pageId}". Please go to Integrations and reconnect your Meta account or select a different page.`
        )
      );
    }
  } catch {
    // Don't block on validation failure — proceed and let Meta reject if needed
  }

  // Pre-flight: check Lead Gen TOS for chatbot/lead form campaigns (Phase 0.2)
  if (isChatbot || isLeadForm || objective === 'OUTCOME_LEADS') {
    try {
      const pageInfo = await metaService.getPageInfo(credentials.pageId, [
        'leadgen_tos_accepted',
      ]);
      if (pageInfo.leadgen_tos_accepted === false) {
        return err(
          new FeatureError(
            CampaignErrorCodes.META_LEAD_GEN_TOS_REQUIRED,
            'Your Facebook Page must accept the Lead Generation Terms of Service before running lead ads.',
            {
              metaError: {
                actionUrl: `https://www.facebook.com/ads/leadgen/tos?page_id=${credentials.pageId}`,
              },
            }
          )
        );
      }
    } catch {
      // Don't block on validation failure — proceed and let Meta reject if needed
    }
  }

  // Resolve experiment variant for chatbot campaigns
  let experimentId: string | undefined;
  let experimentVariant: string | undefined;

  if (isChatbot) {
    const expResult = await getExperimentVariant(db, {
      experimentKey: MESSENGER_OBJECTIVE_EXPERIMENT,
      organizationId,
    });
    if (expResult.success && expResult.data) {
      experimentId = expResult.data.experimentId;
      experimentVariant = expResult.data.variant;
    }
  }

  let metaCampaignId: string | undefined;
  try {
    // Create campaign on Meta (starts as PAUSED)
    // Budget is set at the campaign level (CBO) so it appears in campaign listings
    // Values are in the smallest currency unit (e.g., cents for USD/EUR) from the frontend
    //
    // The objective is passed from the frontend:
    //   - OUTCOME_LEADS → LEAD_GENERATION optimization
    //   - OUTCOME_ENGAGEMENT → CONVERSATIONS optimization (chatbot only)
    const effectiveObjective = objective;

    metaCampaignId = await metaService.createCampaign({
      name,
      objective: effectiveObjective as MetaObjective,
      status: 'PAUSED',
      specialAdCategories: [],
      dailyBudget: dailyBudget || undefined,
      lifetimeBudget: lifetimeBudget || undefined,
    });

    // Resolve destination type and optimization goal for the initial ad set.
    //
    // Chatbot campaigns: use the explicit destinations array when provided,
    // falling back to the legacy defaults. The optimization goal depends
    // on whether WhatsApp is included and whether the targeting is in
    // Europe (GDPR blocks CONVERSATIONS for WhatsApp in EU).
    //
    // Lead form campaigns: LEAD_GENERATION goal + ON_AD destination.
    let adSetDestinationType: MetaDestinationType | undefined;
    let adSetOptimizationGoal: OptimizationGoal;

    if (isChatbot && destinations && destinations.length > 0) {
      adSetDestinationType = resolveDestinationType({
        destinations: destinations as MessagingDestination[],
        objective: effectiveObjective,
      });
      const hasWhatsApp = destinations.includes('whatsapp');
      if (effectiveObjective === 'OUTCOME_LEADS') {
        adSetOptimizationGoal = 'LEAD_GENERATION';
      } else if (hasWhatsApp) {
        // Meta blocks CONVERSATIONS for WhatsApp on EU-based ad accounts
        // regardless of targeting location. Use LINK_CLICKS for all
        // WhatsApp campaigns to avoid runtime rejections.
        adSetOptimizationGoal = 'LINK_CLICKS';
      } else {
        adSetOptimizationGoal = 'CONVERSATIONS';
      }
    } else if (isChatbot) {
      adSetDestinationType =
        effectiveObjective === 'OUTCOME_LEADS'
          ? 'MESSENGER'
          : 'MESSAGING_INSTAGRAM_DIRECT_MESSENGER';
      adSetOptimizationGoal =
        effectiveObjective === 'OUTCOME_ENGAGEMENT'
          ? 'CONVERSATIONS'
          : 'LEAD_GENERATION';
    } else if (isLeadForm) {
      adSetDestinationType = 'ON_AD';
      adSetOptimizationGoal = getOptimizationGoal(objective);
    } else {
      adSetOptimizationGoal = getOptimizationGoal(objective);
    }
    const adSetPromotedObject =
      isChatbot || isLeadForm ? { pageId: credentials.pageId } : undefined;

    const metaAdSetId = await metaService.createAdSet({
      name: `${name} - Ad Set`,
      campaignId: metaCampaignId,
      status: 'PAUSED',
      billingEvent: 'IMPRESSIONS',
      optimizationGoal: adSetOptimizationGoal,
      targeting: buildMetaTargeting(targeting),
      startTime: startDate?.toISOString(),
      endTime: endDate?.toISOString(),
      ...(adSetDestinationType && { destinationType: adSetDestinationType }),
      ...(adSetPromotedObject && { promotedObject: adSetPromotedObject }),
      // DSA (EU ad transparency) — set the Page as both beneficiary and payor
      dsaBeneficiary: credentials.pageId,
      dsaPayor: credentials.pageId,
    });

    // Store local campaign config (follow-up type, chatbot, targeting, ad set ID)
    // Snapshot page + ad account so existing campaigns aren't affected if defaults change
    await db.insert(metaCampaignConfig).values({
      metaCampaignId,
      organizationId,
      metaAdsPageId: credResult.data.resolvedPage.id,
      adAccountId: credentials.adAccountId,
      adAccountCurrency: credentials.adAccountCurrency ?? null,
      followUpType: followUpType ?? 'email_only',
      conversionDestination: conversionDestination ?? null,
      destinationType: adSetDestinationType ?? null,
      leadFormId: isLeadForm ? (leadFormId ?? null) : null,
      locationId: campaignLocation.id,
      targeting,
      metaAdSetId,
      experimentId: experimentId ?? null,
      experimentVariant: experimentVariant ?? null,
    });

    // Landing destination + UTM tagging (plan §9.5).
    //
    // FIRE-AND-FORGET: the campaign and ad set already exist on Meta. A failure
    // to resolve the tenant's host is a missing convenience, not a reason to
    // tear down a live campaign — so this can only ever add a field to the
    // response, never turn a success into an error.
    let destinationUrl: string | undefined;
    if (campaignHasSiteDestination(followUpType ?? 'email_only')) {
      try {
        destinationUrl =
          (await resolveCampaignDestinationUrl(db, {
            organizationId,
            metaCampaignId,
          })) ?? undefined;
      } catch (destinationError) {
        logError(
          'metaCampaigns.createCampaign.resolveDestination',
          destinationError,
          {
            feature: 'meta-campaigns',
            extra: { organizationId, metaCampaignId },
          }
        );
      }
    }

    // Our own record that this campaign exists and where it points — the
    // server-side twin of the pixel, so CAC never depends on Meta answering.
    trackOrgEvent(organizationId, 'meta_campaign_created', {
      metaCampaignId,
      metaAdSetId,
      objective,
      followUpType: followUpType ?? 'email_only',
      // The UTM value every lead from this campaign will carry.
      utmCampaign: metaCampaignId,
      hasSiteDestination: Boolean(destinationUrl),
    });

    return ok({
      metaCampaignId,
      metaAdSetId,
      followUpType: followUpType ?? 'email_only',
      conversionDestination: conversionDestination ?? undefined,
      destinationUrl,
      location: { id: campaignLocation.id, label: campaignLocation.label },
    });
  } catch (error) {
    // Clean up the orphaned Meta campaign if it was created before the failure
    if (metaCampaignId) {
      try {
        await metaService.deleteCampaign(metaCampaignId);
      } catch (cleanupError) {
        logMetaErrorIfUnknown(
          'metaCampaigns.createCampaign.cleanup',
          cleanupError,
          {
            metaCampaignId,
            organizationId,
          }
        );
      }
    }

    return handleMetaError(error, {
      operationName: 'metaCampaigns.createCampaign',
      defaultErrorCode: CampaignErrorCodes.META_SYNC_FAILED,
      defaultUserTitle: 'Failed to Create Campaign',
      credentials: { pageId: credentials.pageId },
      extra: { organizationId },
      db,
      organizationId,
    });
  }
};

/**
 * Create a new Meta campaign and ad set.
 * No local DB record is created - returns Meta IDs directly.
 */
export const createCampaign = (db: DbConnection, input: CreateCampaignInput) =>
  trackedResult(
    'metaCampaigns.createCampaign',
    () => withOrgScope((tx) => createCampaignImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type CreateCampaignResult = Awaited<ReturnType<typeof createCampaign>>;
