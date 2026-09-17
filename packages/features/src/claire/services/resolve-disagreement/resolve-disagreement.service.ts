import {
  type BusinessProfile,
  type Disagreement,
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
import { trackDisagreementResolved } from '../../telemetry/index.js';
import { classifyBusiness } from '../classify-business/index.js';
import {
  type ResolveDisagreementInput,
  resolveDisagreementSchema,
} from './resolve-disagreement.schema.js';

const resolveDisagreementImpl = async (
  db: DbConnection,
  input: ResolveDisagreementInput
): Promise<Result<BusinessProfile>> => {
  const parsed = resolveDisagreementSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationId, resolution, surface = 'ads_new' } = parsed.data;

  const existing = await db.query.businessProfile.findFirst({
    where: eq(businessProfile.organizationId, organizationId),
  });
  if (!existing) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Business profile not found')
    );
  }
  if (!existing.disagreement) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'No pending disagreement to resolve'
      )
    );
  }

  if (resolution === 'owner_held') {
    // Owner sticks with their override. Keep overriddenAxes, mark resolved.
    const resolvedDisagreement: Disagreement = {
      ...existing.disagreement,
      resolution: 'owner_held',
    };
    const [written] = await db
      .update(businessProfile)
      .set({ disagreement: resolvedDisagreement })
      .where(eq(businessProfile.id, existing.id))
      .returning();
    if (!written) {
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to persist disagreement resolution'
        )
      );
    }
    trackDisagreementResolved(organizationId, {
      surface,
      axes: existing.disagreement.axes,
      classifierConfidence: existing.disagreement.classifierConfidence,
      ownerOverride: existing.overriddenAxes
        ? {
            retentionModel: existing.overriddenAxes.retentionModel,
            commitmentLevel: existing.overriddenAxes.commitmentLevel,
            marketPosition: existing.overriddenAxes.marketPosition,
          }
        : undefined,
      classifierProposal: existing.classifierAxes
        ? {
            retentionModel: existing.classifierAxes.retentionModel,
            commitmentLevel: existing.classifierAxes.commitmentLevel,
            marketPosition: existing.classifierAxes.marketPosition,
          }
        : undefined,
      resolution: 'owner_held',
    });
    return ok(written);
  }

  // owner_changed — clear the override and force a fresh classification.
  // The classifier will recompute disagreement (likely null now since the
  // constraint is gone).
  const [cleared] = await db
    .update(businessProfile)
    .set({ overriddenAxes: null, disagreement: null })
    .where(eq(businessProfile.id, existing.id))
    .returning();
  if (!cleared) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to clear axis override'
      )
    );
  }

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
  trackDisagreementResolved(organizationId, {
    surface,
    axes: existing.disagreement.axes,
    classifierConfidence: existing.disagreement.classifierConfidence,
    ownerOverride: existing.overriddenAxes
      ? {
          retentionModel: existing.overriddenAxes.retentionModel,
          commitmentLevel: existing.overriddenAxes.commitmentLevel,
          marketPosition: existing.overriddenAxes.marketPosition,
        }
      : undefined,
    classifierProposal: existing.classifierAxes
      ? {
          retentionModel: existing.classifierAxes.retentionModel,
          commitmentLevel: existing.classifierAxes.commitmentLevel,
          marketPosition: existing.classifierAxes.marketPosition,
        }
      : undefined,
    resolution: 'owner_changed',
  });
  return ok(reclassified.data);
};

export const resolveDisagreement = (
  db: DbConnection,
  input: ResolveDisagreementInput
) =>
  trackedResult(
    'claire.resolveDisagreement',
    () => resolveDisagreementImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        resolution: input.resolution,
      },
    }
  );

export type ResolveDisagreementResult = Awaited<
  ReturnType<typeof resolveDisagreement>
>;
