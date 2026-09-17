import { z } from 'zod';

export const getMembershipPlanSchema = z.object({
  organizationId: z.string().min(1),
  planId: z.string().min(1),
});

export type GetMembershipPlanInput = z.infer<typeof getMembershipPlanSchema>;
