import { z } from 'zod';

export const purchaseMembershipSchema = z.object({
  organizationId: z.string().min(1),
  leadId: z.string().min(1),
  planId: z.string().min(1),
  /** Provenance: the sale line that sold this membership (set by the POS flow). */
  saleItemId: z.string().min(1).optional(),
});

export type PurchaseMembershipInput = z.infer<typeof purchaseMembershipSchema>;
