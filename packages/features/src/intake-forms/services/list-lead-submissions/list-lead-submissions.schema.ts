import { z } from 'zod';
export const listLeadSubmissionsSchema = z.object({
  organizationId: z.string().min(1),
  leadId: z.string().min(1),
});
export type ListLeadSubmissionsInput = z.infer<
  typeof listLeadSubmissionsSchema
>;
