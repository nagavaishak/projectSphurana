import type { FollowUpType, MetaTargeting } from '@borradh-workspace/database';
import {
  isUniqueViolation,
  metaCampaignConfig,
} from '@borradh-workspace/database';
import { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { logError } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { CampaignErrorCodes } from '../../../meta-campaigns/models/index.js';
import {
  type DbConnection,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CredentialsResult,
  getMetaCredentials,
} from '../_shared/get-meta-credentials.js';
import {
  type BackfillCampaignConfigsInput,
  type EnsureCampaignConfigInput,
  backfillCampaignConfigsSchema,
  ensureCampaignConfigSchema,
} from './ensure-campaign-config.schema.js';

/** Meta destination_type values that indicate a messaging (chatbot) ad set. */
const MESSAGING_DESTINATION_TYPES = new Set([
  'WHATSAPP',
  'MESSENGER',
  'INSTAGRAM_DIRECT',
  'MESSAGING_MESSENGER_WHATSAPP',
  'MESSAGING_INSTAGRAM_DIRECT_MESSENGER',
  'MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP',
]);

const toNum = (value: unknown): number | undefined => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
};

/**
 * Best-effort conversion of a Meta ad set's raw `targeting` object back into
 * our local `MetaTargeting` shape, so a newly-backfilled config can rebuild a
 * compatible audience via `buildMetaTargeting` if a new ad set is needed.
 */
const metaTargetingToLocal = (
  raw?: Record<string, unknown>
): MetaTargeting | undefined => {
  if (!raw) return undefined;
  const t: MetaTargeting = {};

  const geo = raw.geo_locations as Record<string, unknown> | undefined;
  if (geo) {
    const countries = geo.countries as string[] | undefined;
    if (Array.isArray(countries) && countries.length > 0) {
      t.countries = countries;
    }
    const custom = geo.custom_locations as
      | Array<Record<string, unknown>>
      | undefined;
    const first = custom?.[0];
    if (first) {
      const lat = toNum(first.latitude);
      const lng = toNum(first.longitude);
      const radius = toNum(first.radius);
      if (lat !== undefined) t.latitude = lat;
      if (lng !== undefined) t.longitude = lng;
      if (radius !== undefined) t.distanceKm = radius;
    }
  }

  const ageMin = toNum(raw.age_min);
  const ageMax = toNum(raw.age_max);
  if (ageMin !== undefined) t.ageMin = ageMin;
  if (ageMax !== undefined) t.ageMax = ageMax;

  const genders = raw.genders as number[] | undefined;
  if (Array.isArray(genders) && genders.length > 0) t.genders = genders;

  return Object.keys(t).length > 0 ? t : undefined;
};

/**
 * Infer the follow-up type for an imported campaign from its ad set. Messaging
 * destinations → chatbot; lead-gen (ON_AD / LEAD_GENERATION / lead_gen_form_id)
 * → lead_form; anything else → email_only (a neutral default that still lets
 * the config exist and unblocks duplication, even if our ad-launch flow doesn't
 * support that campaign type).
 */
const inferFollowUp = (adSet?: {
  destinationType?: string;
  optimizationGoal?: string;
  promotedObject?: Record<string, unknown>;
}): { followUpType: FollowUpType; destinationType: string | null } => {
  const dt = adSet?.destinationType?.toUpperCase();

  if (dt && MESSAGING_DESTINATION_TYPES.has(dt)) {
    return { followUpType: 'chatbot', destinationType: dt };
  }

  const hasLeadForm =
    dt === 'ON_AD' ||
    adSet?.optimizationGoal === 'LEAD_GENERATION' ||
    Boolean(adSet?.promotedObject?.lead_gen_form_id);
  if (hasLeadForm) {
    return { followUpType: 'lead_form', destinationType: dt ?? null };
  }

  return { followUpType: 'email_only', destinationType: dt ?? null };
};

/** Pick the primary ad set for a campaign: active, else first non-archived, else first. */
const pickPrimaryAdSet = <
  T extends { status?: string; effectiveStatus?: string },
>(
  adSets: T[]
): T | undefined => {
  const active = adSets.find(
    (s) => s.effectiveStatus === 'ACTIVE' || s.status === 'ACTIVE'
  );
  if (active) return active;
  const live = adSets.find((s) => {
    const status = s.effectiveStatus ?? s.status;
    return status !== 'ARCHIVED' && status !== 'DELETED';
  });
  return live ?? adSets[0];
};

interface EnsureContext {
  organizationId: string;
  metaService: MetaAdsService;
  credentials: CredentialsResult['credentials'];
  resolvedPage: CredentialsResult['resolvedPage'];
}

/**
 * Core ensure logic given an already-resolved Meta context. Idempotent: if a
 * config row already exists for the campaign, returns `created: false` without
 * touching Meta or the DB.
 */
const ensureConfigForCampaign = async (
  db: DbConnection,
  ctx: EnsureContext,
  metaCampaignId: string
): Promise<Result<{ created: boolean }>> => {
  const existing = await db.query.metaCampaignConfig.findFirst({
    where: eq(metaCampaignConfig.metaCampaignId, metaCampaignId),
    columns: { id: true },
  });
  if (existing) return ok({ created: false });

  // Resolve the campaign's primary ad set and its details so we can infer the
  // follow-up type and reuse its audience.
  let adSetId: string | null = null;
  let followUpType: FollowUpType = 'email_only';
  let destinationType: string | null = null;
  let targeting: MetaTargeting | undefined;

  try {
    const adSets = await ctx.metaService.listAdSets(metaCampaignId);
    const primary = pickPrimaryAdSet(adSets);
    if (primary) {
      adSetId = primary.id;
      const details = await ctx.metaService.getAdSetDetails(primary.id);
      const inferred = inferFollowUp(details);
      followUpType = inferred.followUpType;
      destinationType = inferred.destinationType;
      targeting = metaTargetingToLocal(details.targeting);
    }
  } catch (error) {
    // Couldn't read the ad set — still create a minimal config so the campaign
    // is recognised locally (duplication + listing work); ad-launch into it may
    // be limited until the next sync fills in details.
    logError('metaAds.ensureCampaignConfig', error, {
      feature: 'meta-ads',
      extra: { organizationId: ctx.organizationId, metaCampaignId },
    });
  }

  try {
    await db.insert(metaCampaignConfig).values({
      metaCampaignId,
      organizationId: ctx.organizationId,
      metaAdsPageId: ctx.resolvedPage.id,
      adAccountId: ctx.credentials.adAccountId,
      adAccountCurrency: ctx.credentials.adAccountCurrency ?? null,
      followUpType,
      destinationType,
      targeting,
      metaAdSetId: adSetId,
    });
    return ok({ created: true });
  } catch (error) {
    // Unique constraint on metaCampaignId — a concurrent sync inserted it
    // first. drizzle wraps the postgres.js error, so the constraint lives on
    // the `.cause` chain, not `error.message` (see isUniqueViolation).
    if (
      isUniqueViolation(error, 'meta_campaign_config_meta_campaign_id_unique')
    ) {
      return ok({ created: false });
    }
    throw error;
  }
};

/**
 * Resolve a Meta context (credentials + service) for an organization.
 */
const resolveContext = async (
  db: DbConnection,
  organizationId: string,
  metaAdsPageId?: string
): Promise<Result<EnsureContext>> => {
  const credResult = await getMetaCredentials(db, {
    organizationId,
    metaAdsPageId,
    operationName: 'metaAds.ensureCampaignConfig',
  });
  if (!credResult.success) return credResult;

  return ok({
    organizationId,
    metaService: new MetaAdsService(credResult.data.credentials),
    credentials: credResult.data.credentials,
    resolvedPage: credResult.data.resolvedPage,
  });
};

/**
 * Ensure a local `metaCampaignConfig` row exists for a Meta campaign.
 *
 * Campaigns created directly on Meta (imported / previously-ran) have no config
 * row, which blocks launching new ads into them and copying them. This reads
 * the campaign's ad set from Meta, infers the follow-up type and audience, and
 * writes a config row. Idempotent — a no-op if the config already exists.
 *
 * Runs on the passed connection (no internal scope) so callers can include it
 * in their own transaction.
 */
export const ensureCampaignConfig = async (
  db: DbConnection,
  input: EnsureCampaignConfigInput
): Promise<Result<{ created: boolean }>> => {
  const parsed = ensureCampaignConfigSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(CampaignErrorCodes.CAMPAIGN_NOT_FOUND, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const ctxResult = await resolveContext(
    db,
    parsed.data.organizationId,
    parsed.data.metaAdsPageId
  );
  if (!ctxResult.success) return ctxResult;

  return ensureConfigForCampaign(
    db,
    ctxResult.data,
    parsed.data.metaCampaignId
  );
};

export interface BackfillCampaignConfigsData {
  scanned: number;
  created: number;
}

/**
 * Backfill `metaCampaignConfig` rows for every campaign in the connected ad
 * account that doesn't already have one. Used by the periodic Meta sync so
 * previously-ran campaigns become launch-able and duplicable without any
 * connect-time hook. Resolves credentials once and reuses them across the loop.
 */
export const backfillCampaignConfigs = async (
  db: DbConnection,
  input: BackfillCampaignConfigsInput
): Promise<Result<BackfillCampaignConfigsData>> => {
  const parsed = backfillCampaignConfigsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(CampaignErrorCodes.CAMPAIGN_NOT_FOUND, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;
  const limit = parsed.data.limit ?? 100;

  const ctxResult = await resolveContext(db, organizationId);
  if (!ctxResult.success) return ctxResult;
  const ctx = ctxResult.data;

  let scanned = 0;
  let created = 0;

  const campaigns = await ctx.metaService.listCampaigns(limit);
  for (const campaign of campaigns) {
    scanned++;
    const result = await ensureConfigForCampaign(db, ctx, campaign.id);
    if (result.success && result.data.created) created++;
    // A single bad campaign shouldn't abort the whole backfill — ensure logs
    // its own unexpected errors and returns a Result; we just skip non-creates.
  }

  return ok({ scanned, created });
};
