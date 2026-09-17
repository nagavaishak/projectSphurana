import {
  type BusinessProfile,
  type OverriddenAxes,
  businessProfile,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { classifyBusiness } from '../classify-business/index.js';
import {
  type SetAxisOverrideInput,
  setAxisOverrideSchema,
} from './set-axis-override.schema.js';

const setAxisOverrideImpl = async (
  db: DbConnection,
  input: SetAxisOverrideInput
): Promise<Result<BusinessProfile>> => {
  const parsed = setAxisOverrideSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationId, userId, axes } = parsed.data;

  const existing = await db.query.businessProfile.findFirst({
    where: eq(businessProfile.organizationId, organizationId),
  });
  if (!existing) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'No business profile yet for this organization. Run classification first.'
      )
    );
  }

  // Merge with any existing overrides so the owner can dial axes in one at a
  // time. The audit fields are always rewritten to reflect the latest change.
  const previousOverrides: OverriddenAxes | null = existing.overriddenAxes;
  const overriddenAxes: OverriddenAxes = {
    retentionModel: axes.retentionModel ?? previousOverrides?.retentionModel,
    commitmentLevel: axes.commitmentLevel ?? previousOverrides?.commitmentLevel,
    marketPosition: axes.marketPosition ?? previousOverrides?.marketPosition,
    overriddenAt: new Date().toISOString(),
    overriddenBy: userId,
  };

  const [written] = await db
    .update(businessProfile)
    .set({ overriddenAxes })
    .where(eq(businessProfile.id, existing.id))
    .returning();

  if (!written) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to persist axis override'
      )
    );
  }

  // Immediately re-run classification so `effective` axes + ranked services
  // reflect the new constraints. force: true bypasses the inputHash check —
  // the override IS the input change.
  const reclassified = await classifyBusiness(db, {
    organizationId,
    force: true,
    reason: 'override',
  });
  if (!reclassified.success) {
    // trackedResult strips FeatureError to a plain shape; rewrap so the outer
    // Result type stays consistent.
    return err(
      new FeatureError(reclassified.error.code, reclassified.error.message)
    );
  }
  return ok(reclassified.data);
};

export const setAxisOverride = (
  db: DbConnection,
  input: SetAxisOverrideInput
) =>
  trackedResult(
    'claire.setAxisOverride',
    () => setAxisOverrideImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
    }
  );

export type SetAxisOverrideResult = Awaited<ReturnType<typeof setAxisOverride>>;
