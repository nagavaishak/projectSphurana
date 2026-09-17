import { createHash } from 'node:crypto';
import {
  type ExperimentVariantConfig,
  experiment,
  experimentAssignment,
  withOrgScope,
} from '@borradh-workspace/database';
import {
  getFeatureFlag,
  trackOrgEvent,
} from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { ResolvedVariant } from '../../models/index.js';
import {
  type GetExperimentVariantInput,
  getExperimentVariantSchema,
} from './get-experiment-variant.schema.js';

/**
 * Deterministic variant assignment using a hash of org ID + experiment key.
 * Used as fallback when PostHog is not configured.
 */
const assignVariantLocally = (
  organizationId: string,
  experimentKey: string,
  variants: ExperimentVariantConfig
): string => {
  const hash = createHash('sha256')
    .update(`${organizationId}:${experimentKey}`)
    .digest('hex');

  // Convert first 8 hex chars to a number between 0-100
  const bucket = (Number.parseInt(hash.slice(0, 8), 16) % 10000) / 100;

  const variantEntries = Object.entries(variants);
  let cumulative = 0;

  for (const [key, config] of variantEntries) {
    cumulative += config.weight;
    if (bucket < cumulative) {
      return key;
    }
  }

  // Fallback to last variant (should not happen with correct weights)
  return variantEntries[variantEntries.length - 1][0];
};

/**
 * Resolve the experiment variant for an organization.
 *
 * 1. Check for an existing cached assignment in the DB.
 * 2. If none, evaluate via PostHog (if configured) or local hashing.
 * 3. Persist the assignment and return.
 *
 * Returns null if the experiment doesn't exist or is not active.
 */
const getExperimentVariantImpl = async (
  db: DbConnection,
  input: GetExperimentVariantInput
): Promise<Result<ResolvedVariant | null>> => {
  const parsed = getExperimentVariantSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { experimentKey, organizationId } = parsed.data;

  // Look up the experiment (no org filter — experiment table is Bucket B global)
  const exp = await db.query.experiment.findFirst({
    where: eq(experiment.key, experimentKey),
  });

  if (!exp) {
    return ok(null);
  }

  // Only active experiments assign variants
  if (exp.status !== 'active') {
    // For paused/completed experiments, still return existing assignment if any
    const existing = await withOrgScope(
      (tx) =>
        tx.query.experimentAssignment.findFirst({
          where: and(
            eq(experimentAssignment.experimentId, exp.id),
            eq(experimentAssignment.organizationId, organizationId)
          ),
        }),
      { db }
    );

    if (existing) {
      return ok({ experimentId: exp.id, variant: existing.variant });
    }

    return ok(null);
  }

  // Check for existing assignment
  const existing = await withOrgScope(
    (tx) =>
      tx.query.experimentAssignment.findFirst({
        where: and(
          eq(experimentAssignment.experimentId, exp.id),
          eq(experimentAssignment.organizationId, organizationId)
        ),
      }),
    { db }
  );

  if (existing) {
    return ok({ experimentId: exp.id, variant: existing.variant });
  }

  // No existing assignment — resolve variant
  let variant: string | undefined;

  // Try PostHog first if configured
  if (exp.posthogFeatureKey) {
    const flagValue = await getFeatureFlag(
      organizationId,
      exp.posthogFeatureKey
    );
    if (typeof flagValue === 'string' && flagValue in exp.variants) {
      variant = flagValue;
    }
  }

  // Fallback to local deterministic assignment
  if (!variant) {
    variant = assignVariantLocally(organizationId, experimentKey, exp.variants);
  }

  // Persist the assignment
  await withOrgScope(
    (tx) =>
      tx.insert(experimentAssignment).values({
        experimentId: exp.id,
        organizationId,
        variant,
      }),
    { db }
  );

  // Track the assignment event
  trackOrgEvent(organizationId, 'experiment.assigned', {
    experimentKey,
    experimentId: exp.id,
    variant,
  });

  return ok({ experimentId: exp.id, variant });
};

export const getExperimentVariant = (
  db: DbConnection,
  input: GetExperimentVariantInput
) => getExperimentVariantImpl(db, input);

export type GetExperimentVariantResult = Awaited<
  ReturnType<typeof getExperimentVariant>
>;
