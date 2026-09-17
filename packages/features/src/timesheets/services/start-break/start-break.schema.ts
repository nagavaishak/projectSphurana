import { timeEntrySourceValues } from '@borradh-workspace/labels';
import { z } from 'zod';

/** Allowed clock-skew for a manual break-start time past "now" (5 minutes). */
const MANUAL_FUTURE_SKEW_MS = 5 * 60 * 1000;

export const startBreakSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  timeEntryId: z.string().min(1, 'Time entry ID is required'),
  // Defaults to "now" in the service when omitted. A supplied time may not be
  // more than a small skew in the future — a break cannot start ahead of time.
  at: z.coerce
    .date()
    .refine((d) => d.getTime() <= Date.now() + MANUAL_FUTURE_SKEW_MS, {
      message: 'Break start time cannot be in the future',
    })
    .optional(),
  source: z.enum(timeEntrySourceValues).optional().default('manual'),
});

export type StartBreakInput = z.input<typeof startBreakSchema>;
