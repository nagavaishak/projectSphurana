import { onboardingSession } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { suggestIntroOffer } from '../../../claire/services/suggest-intro-offer/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type PreviewIntroOfferInput,
  type PreviewIntroOfferOutput,
  previewIntroOfferSchema,
} from './preview-intro-offer.schema.js';

/**
 * Read-only twin of `acceptIntroOffer`'s suggestion step: computes the curated
 * intro price for the session's selected service (same `suggestIntroOffer`
 * inputs, including the typed base price lifted into `servicePriceCents`)
 * WITHOUT creating an offer row — so the slide can display the real number.
 */
const previewIntroOfferImpl = async (
  db: DbConnection,
  input: PreviewIntroOfferInput
): Promise<Result<PreviewIntroOfferOutput>> => {
  const parsed = previewIntroOfferSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { userId } = parsed.data;

  const session = await db.query.onboardingSession.findFirst({
    where: eq(onboardingSession.userId, userId),
  });
  if (!session) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Onboarding session not found')
    );
  }
  if (!session.organizationId || !session.selectedServiceId) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'No service selected yet — complete the campaign-pitch slide first'
      )
    );
  }

  const suggestion = await suggestIntroOffer(db, {
    organizationId: session.organizationId,
    serviceId: session.selectedServiceId,
    ...(session.servicePriceCents != null
      ? { oneSessionPrice: session.servicePriceCents / 100 }
      : {}),
  });
  if (!suggestion.success) {
    return err(
      new FeatureError(
        suggestion.error.code,
        suggestion.error.message,
        suggestion.error.details
      )
    );
  }

  const { serviceId, serviceName, advisable, advisoryReason, needsPrice } =
    suggestion.data;
  const suggested = suggestion.data.suggested;

  return ok({
    serviceId,
    serviceName,
    advisable,
    ...(advisoryReason ? { advisoryReason } : {}),
    needsPrice: needsPrice ?? false,
    ...(suggested
      ? {
          offerPriceCents: suggested.offerPriceCents,
          ...(suggested.originalPriceCents != null
            ? { originalPriceCents: suggested.originalPriceCents }
            : {}),
          offerName: suggested.name,
        }
      : {}),
  });
};

export const previewIntroOffer = (
  db: DbConnection,
  input: PreviewIntroOfferInput
) =>
  trackedResult(
    'onboarding.previewIntroOffer',
    () => previewIntroOfferImpl(db, input),
    {
      properties: { userId: input.userId },
      internalErrorsOnly: true,
    }
  );

export type PreviewIntroOfferResult = Awaited<
  ReturnType<typeof previewIntroOffer>
>;
