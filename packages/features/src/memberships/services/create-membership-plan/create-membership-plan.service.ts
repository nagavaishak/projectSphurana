import {
  isUniqueViolation,
  membershipPlan,
  membershipPlanService,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { MembershipPlanWithServices } from '../../models/index.js';
import { validForToStripeInterval } from '../../shared/valid-for.js';
import {
  type CreateMembershipPlanInput,
  createMembershipPlanSchema,
} from './create-membership-plan.schema.js';

// Stripe caps a recurring price's billing interval at three years, expressed
// per unit (3 years / 36 months / 156 weeks / 1095 days).
const STRIPE_MAX_INTERVAL: Record<string, number> = {
  day: 1095,
  week: 156,
  month: 36,
  year: 3,
};

/**
 * Create a membership plan and link the services it covers.
 *
 * Recurring plans do NOT get a Stripe product/price here — those are created
 * lazily on first sale (purchase-membership), so plan creation never depends
 * on the org's Stripe Connect state.
 */
const createMembershipPlanImpl = async (
  db: DbConnection,
  input: CreateMembershipPlanInput
): Promise<Result<MembershipPlanWithServices>> => {
  const parsed = createMembershipPlanSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { serviceIds, ...planData } = parsed.data;

  // A recurring plan becomes a Stripe recurring price, whose billing interval
  // Stripe caps at three years. Reject over-long recurring windows up front so
  // the failure surfaces at plan creation, not at first sale.
  if (planData.pricingType === 'recurring') {
    const { interval, intervalCount } = validForToStripeInterval(
      planData.validFor
    );
    if (intervalCount > (STRIPE_MAX_INTERVAL[interval] ?? 0)) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'A recurring membership cannot bill less often than every 3 years'
        )
      );
    }
  }

  try {
    const [plan] = await db
      .insert(membershipPlan)
      .values({
        organizationId: planData.organizationId,
        name: planData.name,
        description: planData.description ?? null,
        sessionCount: planData.sessionCount ?? null,
        pricingType: planData.pricingType,
        validFor: planData.validFor,
        priceCents: planData.priceCents,
        currency: planData.currency,
        isActive: planData.isActive,
      })
      .returning();

    if (serviceIds.length > 0) {
      await db.insert(membershipPlanService).values(
        serviceIds.map((serviceId) => ({
          planId: plan.id,
          serviceId,
        }))
      );
    }

    return ok({ ...plan, serviceIds });
  } catch (error) {
    // drizzle wraps the postgres.js error — the constraint lives on the
    // `.cause` chain, not `error.message` (see isUniqueViolation). Either the
    // plan's own name (membership_plan_org_name_unique) or a duplicate
    // serviceId in the membershipPlanService batch insert above
    // (membership_plan_service_unique) can raise this.
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

    logError('memberships.createMembershipPlan', error, {
      feature: 'memberships',
      extra: {
        organizationId: planData.organizationId,
        name: planData.name,
      },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create membership plan'
      )
    );
  }
};

export const createMembershipPlan = (
  db: DbConnection,
  input: CreateMembershipPlanInput
) =>
  trackedResult(
    'memberships.createMembershipPlan',
    () => withOrgScope((tx) => createMembershipPlanImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId, name: input.name },
    }
  );

export type CreateMembershipPlanResult = Awaited<
  ReturnType<typeof createMembershipPlan>
>;
