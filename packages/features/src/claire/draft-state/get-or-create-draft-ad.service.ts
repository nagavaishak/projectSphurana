import {
  type MetaAd,
  metaAd,
  metaAdService,
  organizationService,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { listServicesForOrg } from '../../organization-services/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../shared/index.js';
import { getCurrentCycle, setDraftPointer } from '../push-memory/index.js';
import { recomputeRanking } from '../recommendation-engine/index.js';
import { getBusinessProfile } from '../services/get-business-profile/index.js';
import {
  type GetOrCreateDraftAdInput,
  getOrCreateDraftAdSchema,
} from './draft-ad.schema.js';
import {
  buildDefaultAdName,
  pickDefaultRankedService,
} from './draft-defaults.js';

export interface DraftAdWithServices {
  ad: MetaAd;
  serviceIds: string[];
}

/**
 * Get the chat-owned draft ad for this conversation, creating one
 * pre-populated from the top-ranked service if it doesn't exist yet.
 *
 * Conversation linkage: the `assistantRecommendation` row with kind
 * `ad_flow_service_pick` carries `metadata.draftId`. The push-memory row
 * is the single source of truth for "which draft belongs to this
 * conversation" — `metaAd` itself doesn't carry conversation metadata yet
 * (Window 1 didn't add the column).
 *
 * Defaults populated on first creation:
 *  - serviceIds: [topRankedService.id] (or the one the caller passed)
 *  - headline / primaryText: pulled from `rankedService.serviceRecommendationCopy`
 *  - callToAction: BOOK_NOW (the default for treatment-led businesses)
 *  - adPlacement: facebook
 *  - followUpType: lead_form (the existing schema default)
 *  - status: 'draft'
 *
 * Required fields not derivable from the recommendation (`videoId`,
 * `metaCampaignId`, `metaAdsPageId`) are left null on the draft row and
 * must be set by subsequent `set_pending_ad_creative` / `set_pending_ad_*`
 * tools before promote-to-active is allowed.
 */
const getOrCreateDraftAdImpl = async (
  db: DbConnection,
  input: GetOrCreateDraftAdInput
): Promise<Result<DraftAdWithServices>> => {
  const parsed = getOrCreateDraftAdSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, conversationId, serviceId, metaCampaignId } =
    parsed.data;

  // 1. Look for an existing draft via the cycle row.
  const cycle = await getCurrentCycle(db, {
    organizationId,
    conversationId,
    kind: 'ad_flow_service_pick',
  });
  if (!cycle.success) {
    return err(new FeatureError(cycle.error.code, cycle.error.message));
  }

  const cycleDraftId = (cycle.data?.metadata as { draftId?: string } | null)
    ?.draftId;
  if (cycleDraftId) {
    const existing = await db.query.metaAd.findFirst({
      where: and(
        eq(metaAd.id, cycleDraftId),
        eq(metaAd.organizationId, organizationId)
      ),
    });
    if (existing && existing.status === 'draft') {
      const services = await db
        .select({ serviceId: metaAdService.serviceId })
        .from(metaAdService)
        .where(eq(metaAdService.metaAdId, existing.id));
      return ok({ ad: existing, serviceIds: services.map((s) => s.serviceId) });
    }
    // The pointer was stale (draft promoted, deleted, or transitioned). Fall
    // through to create a fresh one and refresh the pointer below.
  }

  // 2. No draft yet — read the recommendation and build defaults.
  const profileResult = await getBusinessProfile(db, { organizationId });
  if (!profileResult.success) {
    return err(
      new FeatureError(
        profileResult.error.code,
        'No business profile yet — Claire is still classifying this business.'
      )
    );
  }

  const servicesResult = await listServicesForOrg(db, { organizationId });
  if (!servicesResult.success) {
    return err(
      new FeatureError(servicesResult.error.code, servicesResult.error.message)
    );
  }
  const liveRanked = recomputeRanking(profileResult.data, servicesResult.data);
  const ranked = pickDefaultRankedService(liveRanked, serviceId);
  if (!ranked) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'No ranked services available. Add services first or wait for classification.'
      )
    );
  }

  // Pull the service name + verify it still exists.
  const service = await db.query.organizationService.findFirst({
    where: and(
      eq(organizationService.id, ranked.serviceId),
      eq(organizationService.organizationId, organizationId)
    ),
  });
  if (!service) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'Ranked service no longer exists in the org menu.'
      )
    );
  }

  const [draft] = await db
    .insert(metaAd)
    .values({
      organizationId,
      metaCampaignId: metaCampaignId ?? null,
      name: buildDefaultAdName({ serviceName: service.name }),
      headline: ranked.serviceRecommendationCopy.title.slice(0, 80),
      primaryText: ranked.serviceRecommendationCopy.body.slice(0, 500),
      callToAction: 'BOOK_NOW',
      followUpType: 'lead_form',
      adPlacement: 'facebook',
      status: 'draft',
    })
    .returning();

  if (!draft) {
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to insert draft ad')
    );
  }

  await db.insert(metaAdService).values({
    metaAdId: draft.id,
    serviceId: ranked.serviceId,
  });

  // 3. Record the cycle ↔ draft link so future lookups land on this row.
  const pointer = await setDraftPointer(db, {
    organizationId,
    conversationId,
    kind: 'ad_flow_service_pick',
    draftId: draft.id,
  });
  if (!pointer.success) {
    return err(new FeatureError(pointer.error.code, pointer.error.message));
  }

  return ok({ ad: draft, serviceIds: [ranked.serviceId] });
};

export const getOrCreateDraftAd = (
  db: DbConnection,
  input: GetOrCreateDraftAdInput
) =>
  trackedResult(
    'claire.draftState.getOrCreateDraftAd',
    () => getOrCreateDraftAdImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
      },
    }
  );

export type GetOrCreateDraftAdResult = Awaited<
  ReturnType<typeof getOrCreateDraftAd>
>;
