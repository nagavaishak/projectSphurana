import {
  organizationPackage,
  organizationPackageItem,
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
  type ReorderPackageItemsInput,
  reorderPackageItemsSchema,
} from './reorder-package-items.schema.js';

const reorderPackageItemsImpl = async (
  db: DbConnection,
  input: ReorderPackageItemsInput
): Promise<Result<{ success: true }>> => {
  const parsed = reorderPackageItemsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { packageId, organizationId, orderedIds } = parsed.data;

  const pkg = await db.query.organizationPackage.findFirst({
    where: and(
      eq(organizationPackage.id, packageId),
      eq(organizationPackage.organizationId, organizationId)
    ),
    columns: { id: true },
  });
  if (!pkg) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Package not found'));
  }

  const items = await db.query.organizationPackageItem.findMany({
    where: and(
      eq(organizationPackageItem.packageId, packageId),
      inArray(organizationPackageItem.id, orderedIds)
    ),
    columns: { id: true },
  });

  if (items.length !== orderedIds.length) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'One or more items do not belong to this package'
      )
    );
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(organizationPackageItem)
        .set({ sortOrder: i })
        .where(eq(organizationPackageItem.id, orderedIds[i]));
    }
  });

  return ok({ success: true as const });
};

export const reorderPackageItems = (
  db: DbConnection,
  input: ReorderPackageItemsInput
) =>
  trackedResult(
    'packages.reorderPackageItems',
    () => withOrgScope((tx) => reorderPackageItemsImpl(tx, input), { db }),
    {
      properties: {
        packageId: input.packageId,
        organizationId: input.organizationId,
      },
    }
  );

export type ReorderPackageItemsResult = Awaited<
  ReturnType<typeof reorderPackageItems>
>;
