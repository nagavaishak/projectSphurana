import { organizationPackage, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
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
  type DeletePackageInput,
  deletePackageSchema,
} from './delete-package.schema.js';

const deletePackageImpl = async (
  db: DbConnection,
  input: DeletePackageInput
): Promise<Result<{ success: true }>> => {
  const parsed = deletePackageSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId } = parsed.data;

  const existing = await db.query.organizationPackage.findFirst({
    where: and(
      eq(organizationPackage.id, id),
      eq(organizationPackage.organizationId, organizationId)
    ),
  });

  if (!existing) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Package not found'));
  }

  try {
    // Items cascade via FK
    await db.delete(organizationPackage).where(eq(organizationPackage.id, id));
    return ok({ success: true as const });
  } catch (error) {
    logError('packages.deletePackage', error, {
      feature: 'packages',
      extra: { id, organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to delete package')
    );
  }
};

export const deletePackage = (db: DbConnection, input: DeletePackageInput) =>
  trackedResult(
    'packages.deletePackage',
    () => withOrgScope((tx) => deletePackageImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );

export type DeletePackageResult = Awaited<ReturnType<typeof deletePackage>>;
