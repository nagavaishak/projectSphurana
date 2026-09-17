import { timeEntrySourceValues } from '@borradh-workspace/labels';
import { z } from 'zod';

/** Allowed clock-skew for a manual clock-in time past "now" (5 minutes). */
const MANUAL_FUTURE_SKEW_MS = 5 * 60 * 1000;

export const clockInSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  practitionerId: z.string().min(1, 'Practitioner ID is required'),
  // Defaults to "now" in the service when omitted. A supplied time may not be
  // more than a small skew in the future — you cannot clock in ahead of time.
  // Field-level refine keeps this a ZodObject so the DTO can still `.omit()`.
  at: z.coerce
    .date()
    .refine((d) => d.getTime() <= Date.now() + MANUAL_FUTURE_SKEW_MS, {
      message: 'Clock-in time cannot be in the future',
    })
    .optional(),
  source: z.enum(timeEntrySourceValues).optional().default('manual'),
  // Authorization context, injected by the controller from the session — never
  // client-supplied. When `requestingUserId` is set, the caller may only clock
  // in the practitioner linked to their own user unless `canManageOthers` (an
  // admin/owner) is true. Omitted by trusted system callers (auto-clock).
  requestingUserId: z.string().min(1).optional(),
  canManageOthers: z.boolean().optional().default(false),
});

export type ClockInInput = z.input<typeof clockInSchema>;
