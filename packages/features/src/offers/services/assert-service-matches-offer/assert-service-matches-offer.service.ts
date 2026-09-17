import { offer, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type AssertServiceMatchesOfferInput,
  assertServiceMatchesOfferSchema,
} from './assert-service-matches-offer.schema.js';

/**
 * Guard that a chosen `serviceId` actually belongs to the offer it is being
 * rendered against.
 *
 * Context (ENG-628): media servers (graphic / video) take a free-form
 * `serviceId` picked by Claire and validate only that it exists and is
 * org-owned — never that it matches the offer the ad is promoting. A
 * valid-but-wrong service (owned by the org, but linked to a *different*
 * offer/service) therefore sails through and gets rendered. This helper
 * closes that gap: it loads the offer's linked service id(s) (org-scoped)
 * and rejects when the incoming `serviceId` is not among them.
 *
 * The offer<->service link lives in the `offer_service` junction table
 * (`packages/database/src/schema/offer.ts`).
 */
const assertServiceMatchesOfferImpl = async (
  db: DbConnection,
  input: AssertServiceMatchesOfferInput
): Promise<Result<void>> => {
  const parsed = assertServiceMatchesOfferSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, offerId, serviceId } = parsed.data;

  // Load the offer (org-scoped) with its linked service ids. Reading through
  // the offer row keeps the org filter explicit rather than relying on RLS
  // alone, and mirrors `getOffer`'s access pattern.
  const offerRow = await withOrgScope(
    (tx) =>
      tx.query.offer.findFirst({
        where: and(
          eq(offer.id, offerId),
          eq(offer.organizationId, organizationId),
          notDeleted(offer)
        ),
        columns: { id: true },
        with: {
          offerServices: { columns: { serviceId: true } },
        },
      }),
    { db }
  );

  // No offer row (absent / other-org / deleted) means there is no linked
  // service to contradict here — the media servers validate offer existence
  // and ownership separately before this check runs. Treat as a pass.
  if (!offerRow) {
    return ok(undefined);
  }

  const linkedServiceIds = offerRow.offerServices.map((os) => os.serviceId);

  // No linked service row: nothing to contradict, so pass. An offer without a
  // service link places no constraint on which service the media renders with.
  if (linkedServiceIds.length === 0) {
    return ok(undefined);
  }

  if (!linkedServiceIds.includes(serviceId)) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'The chosen service does not belong to this offer. Pick a service linked to the offer.',
        { offerId, serviceId, linkedServiceIds }
      )
    );
  }

  return ok(undefined);
};

export const assertServiceMatchesOffer = (
  db: DbConnection,
  input: AssertServiceMatchesOfferInput
) =>
  trackedResult(
    'offers.assertServiceMatchesOffer',
    () => assertServiceMatchesOfferImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        offerId: input.offerId,
        serviceId: input.serviceId,
      },
      internalErrorsOnly: true,
    }
  );

export type AssertServiceMatchesOfferResult = Awaited<
  ReturnType<typeof assertServiceMatchesOffer>
>;
