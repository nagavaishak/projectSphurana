import { z } from 'zod';

export const runAutoClockSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  practitionerId: z.string().min(1, 'Practitioner ID is required'),
  // Evaluation instant — defaults to "now" in the service when omitted
  now: z.coerce.date().optional(),
});

export type RunAutoClockInput = z.input<typeof runAutoClockSchema>;
