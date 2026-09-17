import {
  organizationServiceCategory,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { type SQL, and, asc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListCategoriesInput,
  listCategoriesSchema,
} from './list-categories.schema.js';

const listCategoriesImpl = async (
  db: DbConnection,
  input: ListCategoriesInput
): Promise<Result<(typeof organizationServiceCategory.$inferSelect)[]>> => {
  const parsed = listCategoriesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const conditions: SQL[] = [
    eq(organizationServiceCategory.organizationId, parsed.data.organizationId),
  ];
  if (parsed.data.isActive !== undefined) {
    conditions.push(
      eq(organizationServiceCategory.isActive, parsed.data.isActive)
    );
  }

  const items = await db.query.organizationServiceCategory.findMany({
    where: and(...conditions),
    orderBy: [
      asc(organizationServiceCategory.sortOrder),
      asc(organizationServiceCategory.name),
    ],
  });

  return ok(items);
};

export const listCategories = (db: DbConnection, input: ListCategoriesInput) =>
  trackedResult(
    'serviceCategories.listCategories',
    () => withOrgScope((tx) => listCategoriesImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type ListCategoriesResult = Awaited<ReturnType<typeof listCategories>>;
