import { z } from 'zod';

export const redeemMembershipSessionSchema = z.object({
  organizationId: z.string().min(1),
  leadMembershipId: z.string().min(1),
});

export type RedeemMembershipSessionInput = z.infer<
  typeof redeemMembershipSessionSchema
>;
