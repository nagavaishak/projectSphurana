import {
  type ResourceCategory,
  resourceCategory,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
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
  DEFAULT_RESOURCE_CATEGORIES,
  type SeedDefaultResourceCategoriesInput,
  seedDefaultResourceCategoriesSchema,
} from './seed-default-resource-categories.schema.js';

/**
 * Idempotently give a new org its "Rooms" category. Called from the org-creation
 * flow and safe to re-run: if the org already has ANY category, nothing is
 * written — the org has made its own arrangement and we don't second-guess it.
 */
const seedDefaultResourceCategoriesImpl = async (
  db: DbConnection,
  input: SeedDefaultResourceCategoriesInput
): Promise<
  Result<{ categories: ResourceCategory[]; created: ResourceCategory[] }>
> => {
  const parsed = seedDefaultResourceCategoriesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  try {
    const existing = await db.query.resourceCategory.findMany({
      where: and(
        eq(resourceCategory.organizationId, organizationId),
        notDeleted(resourceCategory)
      ),
    });

    if (existing.length > 0) {
      return ok({ categories: existing, created: [] });
    }

    const created = await db
      .insert(resourceCategory)
      .values(
        DEFAULT_RESOURCE_CATEGORIES.map((preset) => ({
          organizationId,
          ...preset,
        }))
      )
      .onConflictDoNothing()
      .returning();

    return ok({ categories: created, created });
  } catch (error) {
    logError('resources.seedDefaultResourceCategories', error, {
      feature: 'resources',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to seed default resource categories'
      )
    );
  }
};

export const seedDefaultResourceCategories = (
  db: DbConnection,
  input: SeedDefaultResourceCategoriesInput
) =>
  trackedResult(
    'resources.seedDefaultResourceCategories',
    () =>
      withOrgScope((tx) => seedDefaultResourceCategoriesImpl(tx, input), {
        db,
      }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type SeedDefaultResourceCategoriesResult = Awaited<
  ReturnType<typeof seedDefaultResourceCategories>
>;
