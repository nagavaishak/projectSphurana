import { z } from 'zod';

export const approveTimeEntrySchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  timeEntryId: z.string().min(1, 'Time entry ID is required'),
});

export type ApproveTimeEntryInput = z.input<typeof approveTimeEntrySchema>;
