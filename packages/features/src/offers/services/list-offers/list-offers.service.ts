import {
  offer,
  offerLocation,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { type SQL, and, desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  atLocationOrUnassigned,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type ListOffersInput,
  listOffersSchema,
} from './list-offers.schema.js';

export interface ListOffersResponse {
  items: (typeof offer.$inferSelect & {
    serviceIds: string[];
    locationIds: string[];
  })[];
  total: number;
  limit: number;
  offset: number;
}

const listOffersImpl = async (
  db: DbConnection,
  input: ListOffersInput
): Promise<Result<ListOffersResponse>> => {
  const parsed = listOffersSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, state, locationId, limit, offset } = parsed.data;

  const conditions: SQL[] = [
    eq(offer.organizationId, organizationId),
    notDeleted(offer),
  ];

  if (state !== undefined) {
    conditions.push(eq(offer.state, state));
  }

  if (locationId) {
    conditions.push(
      atLocationOrUnassigned(
        db,
        offerLocation,
        offerLocation.offerId,
        offer.id,
        offerLocation.locationId,
        locationId
      )
    );
  }

  const whereClause = and(...conditions);

  const results = await db.query.offer.findMany({
    where: whereClause,
    orderBy: [desc(offer.createdAt)],
    limit,
    offset,
    with: {
      offerServices: true,
      offerLocations: true,
    },
  });

  const allItems = await db.query.offer.findMany({
    where: whereClause,
    columns: { id: true },
  });

  const items = results.map(
    ({ offerServices, offerLocations, ...offerRow }) => ({
      ...offerRow,
      serviceIds: offerServices.map((os) => os.serviceId),
      locationIds: offerLocations.map((ol) => ol.locationId),
    })
  );

  return ok({
    items,
    total: allItems.length,
    limit,
    offset,
  });
};

export const listOffers = (db: DbConnection, input: ListOffersInput) =>
  trackedResult(
    'offers.listOffers',
    () => withOrgScope((tx) => listOffersImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type ListOffersResult = Awaited<ReturnType<typeof listOffers>>;
