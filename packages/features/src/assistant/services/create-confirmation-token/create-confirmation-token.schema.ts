import { claireConfirmationActionValues } from '@borradh-workspace/database';
import { z } from 'zod';

export const createConfirmationTokenSchema = z.object({
  organizationId: z.string().min(1),
  conversationId: z.string().min(1),
  action: z.enum(claireConfirmationActionValues as [string, ...string[]]),
  resourceId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
  /**
   * Override the default 30-minute TTL. Used by tests; production callers
   * should let the service apply the default unless there's a specific reason.
   */
  ttlMinutes: z
    .number()
    .int()
    .min(1)
    .max(60 * 24)
    .optional(),
});

export type CreateConfirmationTokenInput = z.infer<
  typeof createConfirmationTokenSchema
>;
