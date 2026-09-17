import {
  organizationPackage,
  type organizationPackageItem,
  type organizationService,
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
  type GetPackageInput,
  getPackageSchema,
} from './get-package.schema.js';

type PackageRow = typeof organizationPackage.$inferSelect;
type PackageItemRow = typeof organizationPackageItem.$inferSelect;
type ServiceRow = typeof organizationService.$inferSelect;

export interface PackageWithItems extends PackageRow {
  items: (PackageItemRow & { service: ServiceRow })[];
}

const getPackageImpl = async (
  db: DbConnection,
  input: GetPackageInput
): Promise<Result<PackageWithItems>> => {
  const parsed = getPackageSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const pkg = await db.query.organizationPackage.findFirst({
    where: and(
      eq(organizationPackage.id, parsed.data.id),
      eq(organizationPackage.organizationId, parsed.data.organizationId)
    ),
    with: {
      items: {
        with: { service: true },
      },
    },
  });

  if (!pkg) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Package not found'));
  }

  return ok(pkg as PackageWithItems);
};

export const getPackage = (db: DbConnection, input: GetPackageInput) =>
  trackedResult(
    'packages.getPackage',
    () => withOrgScope((tx) => getPackageImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type GetPackageResult = Awaited<ReturnType<typeof getPackage>>;
