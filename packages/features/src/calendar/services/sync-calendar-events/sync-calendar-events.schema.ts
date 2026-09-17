import { z } from 'zod';

export const syncCalendarEventsSchema = z.object({
  calendarAccountId: z.string().min(1),
});

export type SyncCalendarEventsInput = z.infer<typeof syncCalendarEventsSchema>;
