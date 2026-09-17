import {
  type OrgDefaultsRow,
  orgDefaults,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type UpdateOrgDefaultsInput,
  updateOrgDefaultsSchema,
} from './update-org-defaults.schema.js';

const updateOrgDefaultsImpl = async (
  db: DbConnection,
  input: UpdateOrgDefaultsInput
): Promise<Result<OrgDefaultsRow>> => {
  const parsed = updateOrgDefaultsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, ...rest } = parsed.data;

  // Strip undefined keys so we don't overwrite stored values with undefined
  // (drizzle treats `undefined` as "do not set" in update, but in insert
  // we want to omit them entirely so column defaults apply).
  const patch = Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined)
  );

  try {
    const existing = await db.query.orgDefaults.findFirst({
      where: eq(orgDefaults.organizationId, organizationId),
    });

    if (existing) {
      const [updated] = await db
        .update(orgDefaults)
        .set(patch)
        .where(eq(orgDefaults.organizationId, organizationId))
        .returning();

      return ok(updated);
    }

    const [created] = await db
      .insert(orgDefaults)
      .values({
        organizationId,
        ...patch,
      })
      .returning();

    return ok(created);
  } catch (error) {
    logError('orgDefaults.update', error, {
      feature: 'org-defaults',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update org defaults'
      )
    );
  }
};

export const updateOrgDefaults = (
  db: DbConnection,
  input: UpdateOrgDefaultsInput
) =>
  trackedResult(
    'orgDefaults.update',
    () => withOrgScope((tx) => updateOrgDefaultsImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type UpdateOrgDefaultsResult = Awaited<
  ReturnType<typeof updateOrgDefaults>
>;
