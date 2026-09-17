/**
 * `acceptIntroOffer` — the intro-offer slide's accept action.
 *
 * The accepted intro offer is a REAL row in the `offer` table (owner
 * decision, see docs/plans/claire-onboarding.md): creative generation (ad
 * graphics + offer videos) composes badge/pricing/CTA from it, so the offer
 * must exist BEFORE candidates generate.
 *
 * Mirrors Claire's create-campaign flow: `suggestIntroOffer` produces the
 * curated new-client intro (name, prices, `limitPerClient`), then the
 * existing `createOffer` service persists it. When the owner adjusted the
 * price on the slide, that price wins (threaded through `suggestIntroOffer`'s
 * `offerPrice` input, exactly like Claire does when the owner pushes back).
 *
 * Idempotent: if the session already carries an `offerId` (renegotiation /
 * slide revisit), the EXISTING offer row's price is updated instead of
 * creating a duplicate.
 */

import { onboardingSession } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { suggestIntroOffer } from '../../../claire/services/suggest-intro-offer/index.js';
import { createOffer, updateOffer } from '../../../offers/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type AcceptIntroOfferInput,
  type AcceptIntroOfferOutput,
  acceptIntroOfferSchema,
} from './accept-intro-offer.schema.js';

/** Re-wrap a tracked (structural) error into a `FeatureError` for propagation. */
const rewrap = (error: {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}): FeatureError => new FeatureError(error.code, error.message, error.details);

const acceptIntroOfferImpl = async (
  db: DbConnection,
  input: AcceptIntroOfferInput
): Promise<Result<AcceptIntroOfferOutput>> => {
  const parsed = acceptIntroOfferSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { userId, offerPriceCents } = parsed.data;

  // ── 1. Load the session — the slide flow guarantees org + service exist ──
  const session = await db.query.onboardingSession.findFirst({
    where: eq(onboardingSession.userId, userId),
  });
  if (!session) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Onboarding session not found')
    );
  }
  if (!session.organizationId) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'Onboarding session has no organization yet — complete the analysis slide first'
      )
    );
  }
  if (!session.selectedServiceId) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'No service selected yet — complete the campaign-pitch slide first'
      )
    );
  }
  const organizationId = session.organizationId;
  const serviceId = session.selectedServiceId;

  // ── 2. Build the intro offer via the shared suggestion engine ────────────
  // Same deterministic backbone as Claire's create-campaign flow: the curated
  // charm price when the owner took the suggestion, or the owner's own price
  // verbatim (with the discount derived from the regular price when known).
  const suggestion = await suggestIntroOffer(db, {
    organizationId,
    serviceId,
    ...(session.servicePriceCents != null
      ? { oneSessionPrice: session.servicePriceCents / 100 }
      : {}),
    ...(offerPriceCents != null ? { offerPrice: offerPriceCents / 100 } : {}),
  });
  if (!suggestion.success) {
    return err(rewrap(suggestion.error));
  }
  if (!suggestion.data.advisable) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        suggestion.data.advisoryReason ??
          'This service cannot be advertised with a price offer'
      )
    );
  }
  if (suggestion.data.needsPrice || !suggestion.data.suggested) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'No price known for this service yet — set the service price or pass offerPriceCents'
      )
    );
  }
  const suggested = suggestion.data.suggested;

  // `createOffer` rejects fixed_price offers where offer >= original (and a
  // renegotiated price above the regular one makes the Was/Now framing wrong)
  // — only carry the regular price when the intro genuinely undercuts it.
  const originalPriceCents =
    suggested.originalPriceCents != null &&
    suggested.originalPriceCents > suggested.offerPriceCents
      ? suggested.originalPriceCents
      : null;

  // ── 3a. Renegotiation: update the existing offer instead of duplicating ──
  if (session.offerId) {
    const updated = await updateOffer(db, {
      id: session.offerId,
      organizationId,
      code: undefined,
      offerPriceCents: suggested.offerPriceCents,
      originalPriceCents,
    });
    if (!updated.success) {
      return err(rewrap(updated.error));
    }
    return ok({
      offerId: session.offerId,
      offerPriceCents: suggested.offerPriceCents,
    });
  }

  // ── 3b. First accept: create the REAL offer row ──────────────────────────
  const created = await createOffer(db, {
    organizationId,
    name: suggested.name,
    code: null,
    state: 'active',
    discountType: 'fixed_price',
    originalPriceCents,
    offerPriceCents: suggested.offerPriceCents,
    limitPerClient: true,
    serviceIds: [serviceId],
    locationIds: [],
  });
  if (!created.success) {
    return err(rewrap(created.error));
  }

  // ── 4. Pin the offer on the session ───────────────────────────────────────
  try {
    await db
      .update(onboardingSession)
      .set({ offerId: created.data.id })
      .where(eq(onboardingSession.userId, userId));
  } catch (error) {
    logError('onboarding.acceptIntroOffer.updateSession', error, {
      feature: 'onboarding',
      extra: { userId, offerId: created.data.id },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to link the offer to the onboarding session'
      )
    );
  }

  return ok({
    offerId: created.data.id,
    offerPriceCents: suggested.offerPriceCents,
  });
};

export const acceptIntroOffer = (
  db: DbConnection,
  input: AcceptIntroOfferInput
) =>
  trackedResult(
    'onboarding.acceptIntroOffer',
    () => acceptIntroOfferImpl(db, input),
    {
      properties: {
        userId: input.userId,
        offerPriceCents: input.offerPriceCents,
        notes: input.notes,
      },
    }
  );

export type AcceptIntroOfferResult = Awaited<
  ReturnType<typeof acceptIntroOffer>
>;
