import {
  type Offer,
  isUniqueViolation,
  offer,
  offerLocation,
  offerService,
  organizationService,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { listServicesForOrg } from '../../organization-services/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../shared/index.js';
import { recomputeRanking } from '../recommendation-engine/index.js';
import { getBusinessProfile } from '../services/get-business-profile/index.js';
import {
  buildDefaultOfferName,
  pickDefaultRankedService,
} from './draft-defaults.js';
import {
  type UpdateDraftOfferInput,
  updateDraftOfferSchema,
} from './draft-offer.schema.js';

export interface UpdateDraftOfferResponse {
  offer: Offer;
  serviceIds: string[];
  locationIds: string[];
}

/**
 * Update a chat-owned draft offer.
 *
 * `cascadeDefaults: true` (only `set_pending_offer_service` sets this)
 * refreshes derived defaults — currently just the offer name. The
 * discount shape is NOT cascaded; the user's discount choices stick
 * across service swaps.
 */
const updateDraftOfferImpl = async (
  db: DbConnection,
  input: UpdateDraftOfferInput
): Promise<Result<UpdateDraftOfferResponse>> => {
  const parsed = updateDraftOfferSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, draftId, update, cascadeDefaults } = parsed.data;

  const existing = await db.query.offer.findFirst({
    where: and(
      eq(offer.id, draftId),
      eq(offer.organizationId, organizationId),
      notDeleted(offer)
    ),
  });
  if (!existing) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Draft offer not found'));
  }
  if (existing.state !== 'draft') {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'Offer has already been promoted; create a new draft.'
      )
    );
  }

  let cascadedName: string | undefined;
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
          'Selected service is not in the ranked list.'
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
    cascadedName = buildDefaultOfferName({ serviceName: service.name });
  }

  const { serviceIds, locationIds, code, ...scalars } = update;

  // Normalise the code (trim, treat empty as null). Mirrors the offer
  // create/update schemas' transform.
  const normalisedCode =
    code === undefined
      ? undefined
      : code === null
        ? null
        : (() => {
            const trimmed = code.trim();
            return trimmed.length === 0 ? null : trimmed;
          })();

  try {
    const [updated] = await db
      .update(offer)
      .set({
        ...scalars,
        ...(normalisedCode !== undefined ? { code: normalisedCode } : {}),
        ...(cascadedName && !scalars.name ? { name: cascadedName } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(offer.id, draftId), notDeleted(offer)))
      .returning();
    if (!updated) {
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to update draft offer'
        )
      );
    }

    let finalServiceIds: string[];
    if (serviceIds) {
      await db.delete(offerService).where(eq(offerService.offerId, draftId));
      if (serviceIds.length > 0) {
        await db
          .insert(offerService)
          .values(
            serviceIds.map((sid) => ({ offerId: draftId, serviceId: sid }))
          );
      }
      finalServiceIds = serviceIds;
    } else {
      const rows = await db
        .select({ serviceId: offerService.serviceId })
        .from(offerService)
        .where(eq(offerService.offerId, draftId));
      finalServiceIds = rows.map((r) => r.serviceId);
    }

    let finalLocationIds: string[];
    if (locationIds) {
      await db.delete(offerLocation).where(eq(offerLocation.offerId, draftId));
      if (locationIds.length > 0) {
        await db
          .insert(offerLocation)
          .values(
            locationIds.map((lid) => ({ offerId: draftId, locationId: lid }))
          );
      }
      finalLocationIds = locationIds;
    } else {
      const rows = await db
        .select({ locationId: offerLocation.locationId })
        .from(offerLocation)
        .where(eq(offerLocation.offerId, draftId));
      finalLocationIds = rows.map((r) => r.locationId);
    }

    return ok({
      offer: updated,
      serviceIds: finalServiceIds,
      locationIds: finalLocationIds,
    });
  } catch (error) {
    // drizzle wraps the postgres.js error — the constraint lives on the
    // `.cause` chain, not `error.message` (see isUniqueViolation).
    if (isUniqueViolation(error, 'idx_offer_org_code_unique')) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'An offer with that code already exists in this organization'
        )
      );
    }
    logError('claire.draftState.updateDraftOffer', error, {
      feature: 'claire',
      extra: { organizationId, draftId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update draft offer'
      )
    );
  }
};

export const updateDraftOffer = (
  db: DbConnection,
  input: UpdateDraftOfferInput
) =>
  trackedResult(
    'claire.draftState.updateDraftOffer',
    () => updateDraftOfferImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        draftId: input.draftId,
        cascadeDefaults: input.cascadeDefaults,
      },
    }
  );

export type UpdateDraftOfferResult = Awaited<
  ReturnType<typeof updateDraftOffer>
>;
