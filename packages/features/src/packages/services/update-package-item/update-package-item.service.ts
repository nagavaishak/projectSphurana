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
  type UpdatePackageItemInput,
  updatePackageItemSchema,
} from './update-package-item.schema.js';

const updatePackageItemImpl = async (
  db: DbConnection,
  input: UpdatePackageItemInput
): Promise<Result<typeof organizationPackageItem.$inferSelect>> => {
  const parsed = updatePackageItemSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { packageId, itemId, organizationId, quantity, sortOrder } =
    parsed.data;

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

  const existing = await db.query.organizationPackageItem.findFirst({
    where: and(
      eq(organizationPackageItem.id, itemId),
      eq(organizationPackageItem.packageId, packageId)
    ),
  });
  if (!existing) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Package item not found')
    );
  }

  if (quantity === undefined && sortOrder === undefined) {
    return ok(existing);
  }

  const [updated] = await db
    .update(organizationPackageItem)
    .set({
      ...(quantity !== undefined && { quantity }),
      ...(sortOrder !== undefined && { sortOrder }),
    })
    .where(eq(organizationPackageItem.id, itemId))
    .returning();

  return ok(updated);
};

export const updatePackageItem = (
  db: DbConnection,
  input: UpdatePackageItemInput
) =>
  trackedResult(
    'packages.updatePackageItem',
    () => withOrgScope((tx) => updatePackageItemImpl(tx, input), { db }),
    {
      properties: { packageId: input.packageId, itemId: input.itemId },
    }
  );

export type UpdatePackageItemResult = Awaited<
  ReturnType<typeof updatePackageItem>
>;
