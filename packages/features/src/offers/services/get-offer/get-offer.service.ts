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
import { type GetOfferInput, getOfferSchema } from './get-offer.schema.js';

/**
 * Offer with linked service + location IDs.
 *
 * `locationIds === []` means the offer applies to all org locations (the
 * empty-junction convention from the offer rework).
 */
export interface OfferWithServices {
  offer: typeof offer.$inferSelect;
  serviceIds: string[];
  locationIds: string[];
}

const getOfferImpl = async (
  db: DbConnection,
  input: GetOfferInput
): Promise<Result<OfferWithServices>> => {
  const parsed = getOfferSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId } = parsed.data;

  const result = await db.query.offer.findFirst({
    where: and(
      eq(offer.id, id),
      eq(offer.organizationId, organizationId),
      notDeleted(offer)
    ),
    with: {
      offerServices: true,
      offerLocations: true,
    },
  });

  if (!result) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Offer not found', { id })
    );
  }

  const { offerServices, offerLocations, ...offerData } = result;

  return ok({
    offer: offerData,
    serviceIds: offerServices.map((os) => os.serviceId),
    locationIds: offerLocations.map((ol) => ol.locationId),
  });
};

export const getOffer = (db: DbConnection, input: GetOfferInput) =>
  trackedResult(
    'offers.getOffer',
    () => withOrgScope((tx) => getOfferImpl(tx, input), { db }),
    {
      properties: { id: input.id },
      internalErrorsOnly: true,
    }
  );

export type GetOfferResult = Awaited<ReturnType<typeof getOffer>>;
