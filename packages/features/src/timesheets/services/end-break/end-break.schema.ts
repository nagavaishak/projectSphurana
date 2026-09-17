import { z } from 'zod';

export const endBreakSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  timeEntryId: z.string().min(1, 'Time entry ID is required'),
  // Defaults to "now" in the service when omitted
  at: z.coerce.date().optional(),
});

export type EndBreakInput = z.input<typeof endBreakSchema>;
