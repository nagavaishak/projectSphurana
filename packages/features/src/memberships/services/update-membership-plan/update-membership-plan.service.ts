import {
  isUniqueViolation,
  membershipPlan,
  membershipPlanService,
  withOrgScope,
} from '@borradh-workspace/database';
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
import type { MembershipPlanWithServices } from '../../models/index.js';
import {
  type UpdateMembershipPlanInput,
  updateMembershipPlanSchema,
} from './update-membership-plan.schema.js';

/**
 * Update a membership plan. When `serviceIds` is provided the covered
 * services are replaced entirely. Changing a price-affecting field
 * (`priceCents`, `currency`, `validFor`, `pricingType`) on a plan that
 * already has a Stripe price clears `stripePriceId`, so a fresh price is
 * created lazily on the next sale (the Stripe product is kept).
 */
const updateMembershipPlanImpl = async (
  db: DbConnection,
  input: UpdateMembershipPlanInput
): Promise<Result<MembershipPlanWithServices>> => {
  const parsed = updateMembershipPlanSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, planId, serviceIds, ...updates } = parsed.data;

  try {
    const existing = await db.query.membershipPlan.findFirst({
      where: (t, { and: andOp, eq: eqOp }) =>
        andOp(eqOp(t.id, planId), eqOp(t.organizationId, organizationId)),
    });

    if (!existing) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Membership plan not found')
      );
    }

    const values: Partial<typeof membershipPlan.$inferInsert> = {};
    if (updates.name !== undefined) values.name = updates.name;
    if (updates.description !== undefined)
      values.description = updates.description ?? null;
    if (updates.sessionCount !== undefined)
      values.sessionCount = updates.sessionCount ?? null;
    if (updates.pricingType !== undefined)
      values.pricingType = updates.pricingType;
    if (updates.validFor !== undefined) values.validFor = updates.validFor;
    if (updates.priceCents !== undefined)
      values.priceCents = updates.priceCents;
    if (updates.currency !== undefined) values.currency = updates.currency;
    if (updates.isActive !== undefined) values.isActive = updates.isActive;

    // Price-affecting change on a plan with an existing Stripe price →
    // invalidate the price so the next sale creates a fresh one.
    const priceAffectingChanged =
      (updates.priceCents !== undefined &&
        updates.priceCents !== existing.priceCents) ||
      (updates.currency !== undefined &&
        updates.currency !== existing.currency) ||
      (updates.validFor !== undefined &&
        updates.validFor !== existing.validFor) ||
      (updates.pricingType !== undefined &&
        updates.pricingType !== existing.pricingType);
    if (priceAffectingChanged && existing.stripePriceId) {
      values.stripePriceId = null;
    }

    let plan = existing;
    if (Object.keys(values).length > 0) {
      const [updated] = await db
        .update(membershipPlan)
        .set({ ...values, updatedAt: new Date() })
        .where(
          and(
            eq(membershipPlan.id, planId),
            eq(membershipPlan.organizationId, organizationId)
          )
        )
        .returning();
      plan = updated;
    }

    let resolvedServiceIds: string[];
    if (serviceIds !== undefined) {
      await db
        .delete(membershipPlanService)
        .where(eq(membershipPlanService.planId, planId));
      if (serviceIds.length > 0) {
        await db.insert(membershipPlanService).values(
          serviceIds.map((serviceId) => ({
            planId,
            serviceId,
          }))
        );
      }
      resolvedServiceIds = serviceIds;
    } else {
      const joins = await db.query.membershipPlanService.findMany({
        where: (t, { eq: eqOp }) => eqOp(t.planId, planId),
      });
      resolvedServiceIds = joins.map((j) => j.serviceId);
    }

    return ok({ ...plan, serviceIds: resolvedServiceIds });
  } catch (error) {
    // drizzle wraps the postgres.js error — the constraint lives on the
    // `.cause` chain, not `error.message` (see isUniqueViolation).
    if (
      isUniqueViolation(error, 'membership_plan_org_name_unique') ||
      isUniqueViolation(error, 'membership_plan_service_unique')
    ) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'A membership plan with that name already exists'
        )
      );
    }

    logError('memberships.updateMembershipPlan', error, {
      feature: 'memberships',
      extra: { organizationId, planId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update membership plan'
      )
    );
  }
};

export const updateMembershipPlan = (
  db: DbConnection,
  input: UpdateMembershipPlanInput
) =>
  trackedResult(
    'memberships.updateMembershipPlan',
    () => withOrgScope((tx) => updateMembershipPlanImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        planId: input.planId,
      },
    }
  );

export type UpdateMembershipPlanResult = Awaited<
  ReturnType<typeof updateMembershipPlan>
>;
