import { organizationPackage, withOrgScope } from '@borradh-workspace/database';
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
import type { PackageWithItems } from '../get-package/index.js';
import {
  type ListPackagesInput,
  listPackagesSchema,
} from './list-packages.schema.js';

const listPackagesImpl = async (
  db: DbConnection,
  input: ListPackagesInput
): Promise<Result<PackageWithItems[]>> => {
  const parsed = listPackagesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const conditions: SQL[] = [
    eq(organizationPackage.organizationId, parsed.data.organizationId),
  ];
  if (parsed.data.isActive !== undefined) {
    conditions.push(eq(organizationPackage.isActive, parsed.data.isActive));
  }
  if (parsed.data.categoryId) {
    conditions.push(eq(organizationPackage.categoryId, parsed.data.categoryId));
  }

  const items = await db.query.organizationPackage.findMany({
    where: and(...conditions),
    orderBy: [
      asc(organizationPackage.sortOrder),
      asc(organizationPackage.name),
    ],
    with: {
      items: {
        with: { service: true },
      },
    },
  });

  return ok(items as PackageWithItems[]);
};

export const listPackages = (db: DbConnection, input: ListPackagesInput) =>
  trackedResult(
    'packages.listPackages',
    () => withOrgScope((tx) => listPackagesImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type ListPackagesResult = Awaited<ReturnType<typeof listPackages>>;
