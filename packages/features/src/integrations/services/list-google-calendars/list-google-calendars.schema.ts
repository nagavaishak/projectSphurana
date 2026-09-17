import { z } from 'zod';

export const listGoogleCalendarsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  accountId: z.string().min(1, 'Account ID is required'),
});

export type ListGoogleCalendarsInput = z.infer<
  typeof listGoogleCalendarsSchema
>;
