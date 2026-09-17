import { type Sale, sale, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  currencyForCountry,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CreateSaleInput,
  createSaleSchema,
} from './create-sale.schema.js';

const createSaleImpl = async (
  db: DbConnection,
  input: CreateSaleInput
): Promise<Result<Sale>> => {
  const parsed = createSaleSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, createdById, leadId, locationId } = parsed.data;

  try {
    const result = await withOrgScope(
      async (tx) => {
        // Currency comes from the org's primary location country
        // (there is NO org currency setting)
        const primaryLocation = await tx.query.organizationLocation.findFirst({
          where: (t, { and: andOp, eq: eqOp }) =>
            andOp(
              eqOp(t.organizationId, organizationId),
              eqOp(t.isPrimary, true)
            ),
        });

        const currency = currencyForCountry(
          primaryLocation?.country ?? null
        ).code.toLowerCase();

        const [created] = await tx
          .insert(sale)
          .values({
            organizationId,
            createdById,
            leadId: leadId ?? null,
            locationId: locationId ?? null,
            status: 'open',
            currency,
          })
          .returning();

        return created;
      },
      { db }
    );

    return ok(result);
  } catch (error) {
    logError('sales.createSale', error, {
      feature: 'sales',
      extra: { organizationId, leadId, locationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to create sale')
    );
  }
};

export const createSale = (db: DbConnection, input: CreateSaleInput) =>
  trackedResult('sales.createSale', () => createSaleImpl(db, input), {
    properties: { organizationId: input.organizationId },
  });

export type CreateSaleResult = Awaited<ReturnType<typeof createSale>>;
