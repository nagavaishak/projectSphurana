import {
  type Product,
  type ProductLocation,
  product,
  productLocation,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { type SQL, and, asc, count, eq, ilike } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  atLocationOrUnassigned,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListProductsInput,
  listProductsSchema,
} from './list-products.schema.js';

/**
 * A listed product plus the branches that stock it.
 *
 * EMPTY `locationIds` MEANS EVERYWHERE — the `atLocationOrUnassigned`
 * convention, not "stocked nowhere". The import dialog reads it to separate
 * "already here" from "available to copy from another branch".
 */
export type ListedProduct = Product & { locationIds: string[] };

export interface ListProductsResult {
  items: ListedProduct[];
  total: number;
  limit: number;
  offset: number;
}

const listProductsImpl = async (
  db: DbConnection,
  input: ListProductsInput
): Promise<Result<ListProductsResult>> => {
  const parsed = listProductsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    search,
    categoryId,
    brandId,
    supplierId,
    locationId,
    includeInactive,
    limit,
    offset,
  } = parsed.data;

  const conditions: SQL[] = [eq(product.organizationId, organizationId)];
  if (!includeInactive) conditions.push(eq(product.isActive, true));
  if (search) conditions.push(ilike(product.name, `%${search}%`));
  if (categoryId) conditions.push(eq(product.categoryId, categoryId));
  if (brandId) conditions.push(eq(product.brandId, brandId));
  if (supplierId) conditions.push(eq(product.supplierId, supplierId));
  if (locationId) {
    conditions.push(
      atLocationOrUnassigned(
        db,
        productLocation,
        productLocation.productId,
        product.id,
        productLocation.locationId,
        locationId
      )
    );
  }

  const whereClause = and(...conditions);

  try {
    const [items, countResult] = await withOrgScope(
      async (tx) => {
        const rows = await tx.query.product.findMany({
          where: whereClause,
          limit,
          offset,
          orderBy: [asc(product.name)],
          with: { productLocations: true },
        });
        const [ct] = await tx
          .select({ total: count() })
          .from(product)
          .where(whereClause);
        return [rows, ct] as const;
      },
      { db }
    );

    const listed: ListedProduct[] = items.map((row) => {
      const { productLocations, ...productFields } = row as Product & {
        productLocations: ProductLocation[];
      };
      return {
        ...productFields,
        locationIds: (productLocations ?? []).map((pl) => pl.locationId),
      };
    });

    return ok({ items: listed, total: countResult.total, limit, offset });
  } catch (error) {
    logError('inventory.listProducts', error, {
      feature: 'inventory',
      extra: { organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to list products')
    );
  }
};

export const listProducts = (db: DbConnection, input: ListProductsInput) =>
  trackedResult('inventory.listProducts', () => listProductsImpl(db, input), {
    properties: { organizationId: input.organizationId },
  });
