import {
  type Product,
  isUniqueViolation,
  product,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CreateProductInput,
  createProductSchema,
} from './create-product.schema.js';

const createProductImpl = async (
  db: DbConnection,
  input: CreateProductInput
): Promise<Result<Product>> => {
  const parsed = createProductSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const [row] = await withOrgScope(
      (tx) => tx.insert(product).values(parsed.data).returning(),
      { db }
    );
    return ok(row);
  } catch (error) {
    // drizzle wraps the postgres.js error — the constraint lives on the
    // `.cause` chain, not `error.message` (see isUniqueViolation).
    if (isUniqueViolation(error, 'product_org_barcode_unique')) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'A product with this barcode already exists'
        )
      );
    }
    logError('inventory.createProduct', error, {
      feature: 'inventory',
      extra: { organizationId: input.organizationId, name: input.name },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to create product')
    );
  }
};

export const createProduct = (db: DbConnection, input: CreateProductInput) =>
  trackedResult('inventory.createProduct', () => createProductImpl(db, input), {
    properties: { organizationId: input.organizationId },
  });
