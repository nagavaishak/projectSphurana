import { z } from 'zod';

export const updateTimeEntrySchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  timeEntryId: z.string().min(1, 'Time entry ID is required'),
  clockIn: z.coerce.date().optional(),
  // null re-opens the entry (status → open)
  clockOut: z.coerce.date().nullable().optional(),
});

export type UpdateTimeEntryInput = z.input<typeof updateTimeEntrySchema>;
