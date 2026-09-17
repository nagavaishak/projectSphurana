import { z } from 'zod';

export const stopCalendarWatchSchema = z.object({
  calendarAccountId: z.string().min(1),
  organizationId: z.string().min(1),
});

export type StopCalendarWatchInput = z.infer<typeof stopCalendarWatchSchema>;
