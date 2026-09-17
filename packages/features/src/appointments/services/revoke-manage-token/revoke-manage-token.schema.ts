import { z } from 'zod';

export const revokeManageTokenSchema = z.object({
  appointmentId: z.string().min(1),
  /** The RAW token to revoke — hashed here to find the row. */
  token: z.string().min(1),
});

export type RevokeManageTokenInput = z.infer<typeof revokeManageTokenSchema>;
