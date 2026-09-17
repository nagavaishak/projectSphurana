import type {
  LeadMembership,
  MembershipPlan,
  MembershipPlanService,
} from '@borradh-workspace/database';

export type { LeadMembership, MembershipPlan, MembershipPlanService };

/** Membership plan with the ids of the services it covers. */
export type MembershipPlanWithServices = MembershipPlan & {
  serviceIds: string[];
};

/** Lead membership joined with its plan (list/detail responses). */
export type LeadMembershipWithPlan = LeadMembership & {
  plan: MembershipPlan;
};
