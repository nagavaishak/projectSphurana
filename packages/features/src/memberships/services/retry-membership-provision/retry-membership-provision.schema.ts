import { z } from 'zod';

export const retryMembershipProvisionSchema = z.object({
  organizationId: z.string().min(1),
  saleId: z.string().min(1),
});

export type RetryMembershipProvisionInput = z.infer<
  typeof retryMembershipProvisionSchema
>;
