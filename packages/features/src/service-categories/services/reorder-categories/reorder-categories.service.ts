import {
  organizationServiceCategory,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ReorderCategoriesInput,
  reorderCategoriesSchema,
} from './reorder-categories.schema.js';

const reorderCategoriesImpl = async (
  db: DbConnection,
  input: ReorderCategoriesInput
): Promise<Result<{ success: true }>> => {
  const parsed = reorderCategoriesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, orderedIds } = parsed.data;

  const categories = await db.query.organizationServiceCategory.findMany({
    where: and(
      eq(organizationServiceCategory.organizationId, organizationId),
      inArray(organizationServiceCategory.id, orderedIds)
    ),
    columns: { id: true },
  });

  if (categories.length !== orderedIds.length) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'One or more categories do not belong to this organization'
      )
    );
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(organizationServiceCategory)
        .set({ sortOrder: i })
        .where(eq(organizationServiceCategory.id, orderedIds[i]));
    }
  });

  return ok({ success: true as const });
};

export const reorderCategories = (
  db: DbConnection,
  input: ReorderCategoriesInput
) =>
  trackedResult(
    'serviceCategories.reorderCategories',
    () => withOrgScope((tx) => reorderCategoriesImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type ReorderCategoriesResult = Awaited<
  ReturnType<typeof reorderCategories>
>;
