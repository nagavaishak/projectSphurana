import { assignEntityLocationsRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for replacing which branches sold a membership plan.
 *
 * DERIVED from the canonical wire contract
 * (`assignEntityLocationsRequestBase` in `@borradh-workspace/contracts`) by
 * extending the server-injected context: `planId` is the route param and
 * `organizationId` comes from the session.
 *
 * A bare id list rather than the assignment objects services use, because
 * `membership_plan_location` has no override columns — see the contract.
 */
export const assignMembershipPlanLocationsSchema =
  assignEntityLocationsRequestBase.extend({
    planId: z.string().min(1, 'Plan ID is required'),
    organizationId: z.string().min(1, 'Organization ID is required'),
  });

export type AssignMembershipPlanLocationsInput = z.infer<
  typeof assignMembershipPlanLocationsSchema
>;
