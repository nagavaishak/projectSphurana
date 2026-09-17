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
import { recomputeRanking } from '../recommendation-engine/index.js';
import { getBusinessProfile } from '../services/get-business-profile/index.js';
import {
  type UpdateDraftAdInput,
  updateDraftAdSchema,
} from './draft-ad.schema.js';
import {
  buildDefaultAdName,
  pickDefaultRankedService,
} from './draft-defaults.js';

export interface UpdateDraftAdResponse {
  ad: MetaAd;
  serviceIds: string[];
}

/**
 * Update a chat-owned draft ad.
 *
 * Behaviour:
 *  - All fields in `input.update` are applied verbatim (`undefined` left
 *    intact). `serviceIds`, when present, REPLACES the entire junction
 *    table — chat uses single-service ads, but the schema allows
 *    multi-service so the field is plural.
 *  - When `cascadeDefaults` is true (only `set_pending_ad_service` sets
 *    this), the service change triggers a refresh of derived defaults
 *    (name, headline, primaryText) from the corresponding ranked entry.
 *    Subsequent `set_pending_ad_*` calls have `cascadeDefaults: false`
 *    so per-field overrides stick.
 *  - The draft must be `status='draft'` and belong to the org; promoted
 *    ads cannot be edited via this path.
 */
const updateDraftAdImpl = async (
  db: DbConnection,
  input: UpdateDraftAdInput
): Promise<Result<UpdateDraftAdResponse>> => {
  const parsed = updateDraftAdSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, draftId, update, cascadeDefaults } = parsed.data;

  const existing = await db.query.metaAd.findFirst({
    where: and(
      eq(metaAd.id, draftId),
      eq(metaAd.organizationId, organizationId)
    ),
  });
  if (!existing) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Draft ad not found'));
  }
  if (existing.status !== 'draft') {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'Ad has already been promoted; create a new draft.'
      )
    );
  }

  let cascaded: {
    headline?: string;
    primaryText?: string;
    name?: string;
  } = {};

  const [firstServiceId] = update.serviceIds ?? [];
  if (cascadeDefaults && firstServiceId) {
    const newServiceId = firstServiceId;
    const profile = await getBusinessProfile(db, { organizationId });
    if (!profile.success) {
      return err(new FeatureError(profile.error.code, profile.error.message));
    }
    const servicesResult = await listServicesForOrg(db, { organizationId });
    if (!servicesResult.success) {
      return err(
        new FeatureError(
          servicesResult.error.code,
          servicesResult.error.message
        )
      );
    }
    const liveRanked = recomputeRanking(profile.data, servicesResult.data);
    const ranked = pickDefaultRankedService(liveRanked, newServiceId);
    if (!ranked) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          'Selected service is not in the ranked list. Pass a serviceId from get_alternative_recommendation.'
        )
      );
    }
    const service = await db.query.organizationService.findFirst({
      where: and(
        eq(organizationService.id, newServiceId),
        eq(organizationService.organizationId, organizationId)
      ),
    });
    if (!service) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          'Service no longer exists in the org menu.'
        )
      );
    }
    cascaded = {
      headline: ranked.serviceRecommendationCopy.title.slice(0, 80),
      primaryText: ranked.serviceRecommendationCopy.body.slice(0, 500),
      name: buildDefaultAdName({ serviceName: service.name }),
    };
  }

  // Apply scalar updates. We intentionally do not spread `update` because
  // it includes `serviceIds`, which lives in a junction table.
  const { serviceIds, ...scalars } = update;
  const [updated] = await db
    .update(metaAd)
    .set({
      ...scalars,
      // cascaded values take precedence over scalars only when the caller
      // did not provide their own override
      ...(cascaded.headline && !scalars.headline
        ? { headline: cascaded.headline }
        : {}),
      ...(cascaded.primaryText && !scalars.primaryText
        ? { primaryText: cascaded.primaryText }
        : {}),
      ...(cascaded.name && !scalars.name ? { name: cascaded.name } : {}),
      updatedAt: new Date(),
    })
    .where(eq(metaAd.id, draftId))
    .returning();
  if (!updated) {
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to update draft ad')
    );
  }

  let finalServiceIds: string[];
  if (serviceIds) {
    await db.delete(metaAdService).where(eq(metaAdService.metaAdId, draftId));
    if (serviceIds.length > 0) {
      await db
        .insert(metaAdService)
        .values(
          serviceIds.map((sid) => ({ metaAdId: draftId, serviceId: sid }))
        );
    }
    finalServiceIds = serviceIds;
  } else {
    const rows = await db
      .select({ serviceId: metaAdService.serviceId })
      .from(metaAdService)
      .where(eq(metaAdService.metaAdId, draftId));
    finalServiceIds = rows.map((r) => r.serviceId);
  }

  return ok({ ad: updated, serviceIds: finalServiceIds });
};

export const updateDraftAd = (db: DbConnection, input: UpdateDraftAdInput) =>
  trackedResult(
    'claire.draftState.updateDraftAd',
    () => updateDraftAdImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        draftId: input.draftId,
        cascadeDefaults: input.cascadeDefaults,
      },
    }
  );

export type UpdateDraftAdResult = Awaited<ReturnType<typeof updateDraftAd>>;
