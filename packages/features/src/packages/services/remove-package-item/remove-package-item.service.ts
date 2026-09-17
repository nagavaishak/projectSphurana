import {
  organizationPackage,
  organizationPackageItem,
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
  type RemovePackageItemInput,
  removePackageItemSchema,
} from './remove-package-item.schema.js';

const removePackageItemImpl = async (
  db: DbConnection,
  input: RemovePackageItemInput
): Promise<Result<{ success: true }>> => {
  const parsed = removePackageItemSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { packageId, itemId, organizationId } = parsed.data;

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

  const item = await db.query.organizationPackageItem.findFirst({
    where: and(
      eq(organizationPackageItem.id, itemId),
      eq(organizationPackageItem.packageId, packageId)
    ),
  });
  if (!item) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Package item not found')
    );
  }

  await db
    .delete(organizationPackageItem)
    .where(eq(organizationPackageItem.id, itemId));

  return ok({ success: true as const });
};

export const removePackageItem = (
  db: DbConnection,
  input: RemovePackageItemInput
) =>
  trackedResult(
    'packages.removePackageItem',
    () => withOrgScope((tx) => removePackageItemImpl(tx, input), { db }),
    {
      properties: { packageId: input.packageId, itemId: input.itemId },
    }
  );

export type RemovePackageItemResult = Awaited<
  ReturnType<typeof removePackageItem>
>;
