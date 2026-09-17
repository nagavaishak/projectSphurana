import { z } from 'zod';

export const listBlockedTimeTypesSchema = z.object({
  organizationId: z.string().min(1),
});

export type ListBlockedTimeTypesInput = z.infer<
  typeof listBlockedTimeTypesSchema
>;
