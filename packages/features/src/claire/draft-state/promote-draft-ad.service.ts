import {
  type MetaAd,
  metaAd,
  metaAdService,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { launchAd } from '../../meta-ads/services/launch-ad/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../shared/index.js';
import {
  type PromoteDraftAdInput,
  promoteDraftAdSchema,
} from './draft-ad.schema.js';

export interface PromoteDraftAdResponse {
  ad: MetaAd;
  metaCampaignId: string;
  metaAdSetId: string;
}

/**
 * Promote a chat-owned draft ad to a live Meta launch.
 *
 * Flow:
 *  1. Load + validate the draft row.
 *  2. Forward its fields to the existing `launchAd` feature service,
 *     which creates a fresh `metaAd` row in `status='launching'` and
 *     fires the background finalizer for upload/creative/activation.
 *  3. Delete the original draft row to keep the dashboard clean —
 *     `launchAd` always inserts a new row (see launch-ad.service.ts),
 *     so we end up with the launched row owning the lifecycle.
 *
 * `launchAd` is the single source of truth for the launch sequence; we
 * never poke Meta directly from this path. If launch fails, the draft
 * remains intact so the operator can fix the issue and try again.
 */
const promoteDraftAdImpl = async (
  db: DbConnection,
  input: PromoteDraftAdInput
): Promise<Result<PromoteDraftAdResponse>> => {
  const parsed = promoteDraftAdSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, draftId } = parsed.data;

  const draft = await db.query.metaAd.findFirst({
    where: and(
      eq(metaAd.id, draftId),
      eq(metaAd.organizationId, organizationId)
    ),
  });
  if (!draft) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Draft ad not found'));
  }
  if (draft.status !== 'draft') {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'Draft has already been promoted; nothing to publish.'
      )
    );
  }
  if (!draft.metaCampaignId) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'Draft is missing metaCampaignId; pick a campaign before publishing.'
      )
    );
  }
  if (!draft.videoId && !draft.graphicId) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'Draft is missing a creative (a video or a graphic). Set one before publishing.'
      )
    );
  }
  if (!draft.targetingOverride) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'Draft is missing targeting. Set targeting before publishing.'
      )
    );
  }

  const linked = await db
    .select({ serviceId: metaAdService.serviceId })
    .from(metaAdService)
    .where(eq(metaAdService.metaAdId, draftId));
  const serviceIds = linked.map((r) => r.serviceId);
  if (serviceIds.length === 0) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'Draft is missing serviceIds. Set one before publishing.'
      )
    );
  }

  const launched = await launchAd(db, {
    metaCampaignId: draft.metaCampaignId,
    videoId: draft.videoId ?? undefined,
    graphicId: draft.graphicId ?? undefined,
    organizationId,
    name: draft.name,
    headline: draft.headline ?? undefined,
    primaryText: draft.primaryText ?? undefined,
    description: draft.description ?? undefined,
    callToAction: draft.callToAction ?? 'LEARN_MORE',
    destinationUrl: draft.destinationUrl ?? undefined,
    targeting: draft.targetingOverride ?? undefined,
    followUpType: draft.followUpType,
    leadFormId: draft.leadFormId ?? undefined,
    sequenceId: draft.sequenceId ?? undefined,
    serviceIds,
    adPlacement: draft.adPlacement,
    // The DB enum carries a legacy 'instagram_direct' value the new launch
    // schema doesn't accept. Drop it (only chat-launched drafts hit this
    // path, so the legacy value never surfaces in practice).
    conversionDestination:
      draft.conversionDestination === 'messenger' ||
      draft.conversionDestination === 'whatsapp'
        ? draft.conversionDestination
        : undefined,
    destinations:
      (draft.destinations as
        | ('whatsapp' | 'messenger' | 'instagram_dm')[]
        | null) ?? undefined,
    metaAdsPageId: draft.metaAdsPageId ?? undefined,
  });
  if (!launched.success) {
    return err(new FeatureError(launched.error.code, launched.error.message));
  }

  // Delete the draft row so the dashboard only shows the launched ad.
  // Junction rows are cascaded by FK.
  await db.delete(metaAd).where(eq(metaAd.id, draftId));

  return ok(launched.data);
};

export const promoteDraftAd = (db: DbConnection, input: PromoteDraftAdInput) =>
  trackedResult(
    'claire.draftState.promoteDraftAd',
    () => promoteDraftAdImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        draftId: input.draftId,
      },
    }
  );

export type PromoteDraftAdResult = Awaited<ReturnType<typeof promoteDraftAd>>;
