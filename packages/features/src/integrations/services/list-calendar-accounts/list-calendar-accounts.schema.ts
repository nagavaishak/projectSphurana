import { z } from 'zod';

export const listCalendarAccountsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type ListCalendarAccountsInput = z.infer<
  typeof listCalendarAccountsSchema
>;
