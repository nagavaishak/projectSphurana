import { z } from 'zod';

export const cancelLeadMembershipSchema = z.object({
  organizationId: z.string().min(1),
  leadMembershipId: z.string().min(1),
});

export type CancelLeadMembershipInput = z.infer<
  typeof cancelLeadMembershipSchema
>;
