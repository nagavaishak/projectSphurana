import { claireConfirmationActionValues } from '@borradh-workspace/database';
import { z } from 'zod';

export const verifyConfirmationTokenSchema = z.object({
  organizationId: z.string().min(1),
  conversationId: z.string().min(1),
  action: z.enum(claireConfirmationActionValues as [string, ...string[]]),
  /**
   * Optional resource binding. Some destructive tools (e.g. `create_lead`,
   * `create_service`) don't have a natural resource identifier the model can
   * echo back on the second call — the resource doesn't exist yet, and the
   * summary's `resourceId` is fabricated from input fields. For those tools
   * the factory passes `undefined`; we still bind on (org, conversation,
   * action) plus the payload-mismatch check upstream, which is sufficient
   * because token ids are unguessable.
   */
  resourceId: z.string().min(1).optional(),
  token: z.string().min(1),
});

export type VerifyConfirmationTokenInput = z.infer<
  typeof verifyConfirmationTokenSchema
>;
