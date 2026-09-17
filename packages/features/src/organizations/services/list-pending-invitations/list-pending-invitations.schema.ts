import { z } from 'zod';

export const listPendingInvitationsSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export type ListPendingInvitationsInput = z.infer<
  typeof listPendingInvitationsSchema
>;
