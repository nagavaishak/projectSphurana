import { z } from 'zod';

export const clockOutSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  timeEntryId: z.string().min(1, 'Time entry ID is required'),
  // Defaults to "now" in the service when omitted
  at: z.coerce.date().optional(),
  // Authorization context, injected by the controller from the session — never
  // client-supplied. When `requestingUserId` is set, the caller may only clock
  // out their own linked practitioner's entry unless `canManageOthers` (an
  // admin/owner) is true. Omitted by trusted system callers (auto-clock).
  requestingUserId: z.string().min(1).optional(),
  canManageOthers: z.boolean().optional().default(false),
});

export type ClockOutInput = z.input<typeof clockOutSchema>;
