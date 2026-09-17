import { z } from 'zod';

export const deleteMembershipPlanSchema = z.object({
  organizationId: z.string().min(1),
  planId: z.string().min(1),
});

export type DeleteMembershipPlanInput = z.infer<
  typeof deleteMembershipPlanSchema
>;
