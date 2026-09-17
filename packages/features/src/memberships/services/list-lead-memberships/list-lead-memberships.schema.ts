import { leadMembershipStatusValues } from '@borradh-workspace/labels';
import { z } from 'zod';

export const listLeadMembershipsSchema = z.object({
  organizationId: z.string().min(1),
  leadId: z.string().min(1).optional(),
  status: z.enum(leadMembershipStatusValues).optional(),
});

export type ListLeadMembershipsInput = z.infer<
  typeof listLeadMembershipsSchema
>;
