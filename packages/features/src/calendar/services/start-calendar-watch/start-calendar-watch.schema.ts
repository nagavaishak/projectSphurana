import { z } from 'zod';

export const startCalendarWatchSchema = z.object({
  calendarAccountId: z.string().min(1),
  organizationId: z.string().min(1),
});

export type StartCalendarWatchInput = z.infer<typeof startCalendarWatchSchema>;
