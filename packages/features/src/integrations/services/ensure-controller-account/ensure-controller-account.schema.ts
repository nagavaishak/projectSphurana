import { z } from 'zod';

export const ensureControllerAccountSchema = z.object({
  organizationId: z.string().min(1),
  // Requesting user, used as the account representative prefill
  userId: z.string().min(1).optional(),
  userEmail: z.string().email().optional(),
});

export type EnsureControllerAccountInput = z.input<
  typeof ensureControllerAccountSchema
>;
