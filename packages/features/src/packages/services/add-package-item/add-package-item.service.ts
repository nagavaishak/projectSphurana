import {
  organizationPackage,
  organizationPackageItem,
  organizationService,
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
  type AddPackageItemInput,
  addPackageItemSchema,
} from './add-package-item.schema.js';

const addPackageItemImpl = async (
  db: DbConnection,
  input: AddPackageItemInput
): Promise<Result<typeof organizationPackageItem.$inferSelect>> => {
  const parsed = addPackageItemSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { packageId, organizationId, serviceId, quantity, sortOrder } =
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

  // Validate service belongs to same org
  const service = await db.query.organizationService.findFirst({
    where: and(
      eq(organizationService.id, serviceId),
      eq(organizationService.organizationId, organizationId)
    ),
    columns: { id: true },
  });
  if (!service) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Service not found in this organization'
      )
    );
  }

  // Duplicate check
  const existing = await db.query.organizationPackageItem.findFirst({
    where: and(
      eq(organizationPackageItem.packageId, packageId),
      eq(organizationPackageItem.serviceId, serviceId)
    ),
  });
  if (existing) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'This service is already in the package'
      )
    );
  }

  const [created] = await db
    .insert(organizationPackageItem)
    .values({ packageId, serviceId, quantity, sortOrder })
    .returning();

  return ok(created);
};

export const addPackageItem = (db: DbConnection, input: AddPackageItemInput) =>
  trackedResult(
    'packages.addPackageItem',
    () => withOrgScope((tx) => addPackageItemImpl(tx, input), { db }),
    {
      properties: {
        packageId: input.packageId,
        serviceId: input.serviceId,
      },
    }
  );

export type AddPackageItemResult = Awaited<ReturnType<typeof addPackageItem>>;
