import { z } from 'zod';

export const claimPendingMetaConnectionSchema = z.object({
  pendingConnectionId: z.string().min(1),
  organizationId: z.string().min(1),
  claimedById: z.string().min(1),
  /** Pages from this connection that belong to the organization. */
  pageIds: z.array(z.string().min(1)).min(1, 'Select at least one Page'),
  adAccountId: z.string().min(1).optional(),
  adAccountName: z.string().optional(),
});

export type ClaimPendingMetaConnectionInput = z.infer<
  typeof claimPendingMetaConnectionSchema
>;
