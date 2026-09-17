import {
  organizationServiceCategory,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CreateCategoryInput,
  createCategorySchema,
} from './create-category.schema.js';

const createCategoryImpl = async (
  db: DbConnection,
  input: CreateCategoryInput
): Promise<Result<typeof organizationServiceCategory.$inferSelect>> => {
  const parsed = createCategorySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, name } = parsed.data;

  const existing = await db.query.organizationServiceCategory.findFirst({
    where: and(
      eq(organizationServiceCategory.organizationId, organizationId),
      eq(organizationServiceCategory.name, name)
    ),
  });

  if (existing) {
    return err(
      new FeatureError(
        ErrorCodes.ALREADY_EXISTS,
        `Category "${name}" already exists in this organization`
      )
    );
  }

  const [created] = await db
    .insert(organizationServiceCategory)
    .values({
      organizationId,
      name,
      description: parsed.data.description ?? null,
      sortOrder: parsed.data.sortOrder,
      isActive: parsed.data.isActive,
    })
    .returning();

  return ok(created);
};

export const createCategory = (db: DbConnection, input: CreateCategoryInput) =>
  trackedResult(
    'serviceCategories.createCategory',
    () => withOrgScope((tx) => createCategoryImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId, name: input.name },
    }
  );

export type CreateCategoryResult = Awaited<ReturnType<typeof createCategory>>;
