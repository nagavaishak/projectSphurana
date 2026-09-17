import { z } from 'zod';

export const updateCalendarSelectionSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  accountId: z.string().min(1, 'Account ID is required'),
  calendarId: z.string().min(1, 'Calendar ID is required'),
});

export type UpdateCalendarSelectionInput = z.infer<
  typeof updateCalendarSelectionSchema
>;
